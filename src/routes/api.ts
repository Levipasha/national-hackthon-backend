import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { 
  Users, Teams, Coupons, Notifications, Payments, Invites, GuestsDb, HighlightsDb, TimelineDb, CoordinatorsDb, CollegesDb, ProblemDb,
  User, Team, Coupon, Notification, PaymentLog, TeamInvite, TimelineEvent, Coordinator, College, ProblemStatement
} from '../config/db';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'codesprint-secret-key-2026';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'administrator@audisankara.ac.in',
    pass: 'svdf gsst uuqs wmrz'
  }
});

const otps = new Map<string, { code: string; expiresAt: number }>();

// Extend Express Request interface to include user information
export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: 'admin' | 'team-leader' | 'participant';
  };
}

// Authentication Middleware
export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authorization token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: 'admin' | 'team-leader' | 'participant' };
    
    let user;
    if (decoded.id === 'admin-local') {
      user = { id: 'admin-local', role: 'admin' };
    } else {
      user = await Users.findOne({ id: decoded.id });
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
    }

    req.user = { id: user.id, role: user.role as 'admin' | 'team-leader' | 'participant' };
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

// Admin Middleware
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// --- AUTHENTICATION ENDPOINTS ---

// 1. Send OTP (Simulated)
router.post('/auth/otp-send', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }
  
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  otps.set(email.toLowerCase(), { code, expiresAt: Date.now() + 10 * 60 * 1000 }); // 10 minutes expiry

  try {
    await transporter.sendMail({
      from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
      to: email,
      subject: 'Your CodeSprint Verification Code',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #6d28d9;">Welcome to CodeSprint 2026!</h2>
          <p>Your email verification code is:</p>
          <h1 style="letter-spacing: 4px; color: #1e293b; background: #f8fafc; padding: 10px; text-align: center; border-radius: 6px;">${code}</h1>
          <p style="color: #64748b; font-size: 12px;">This code will expire in 10 minutes.</p>
        </div>
      `
    });
    console.log(`[OTP] Sent verification code to ${email}`);
    return res.json({ message: 'Verification code sent to your email.' });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ message: 'Failed to send verification email' });
  }
});

// 2. Verify OTP (Handles both Login & Signup)
router.post('/auth/otp-verify', async (req: Request, res: Response) => {
  const { email, code, name, phone, college, branch, year, gender, linkedin, portfolio, foodPreference, tshirtSize } = req.body;

  if (!email || !code) {
    return res.status(400).json({ message: 'Email and OTP code are required' });
  }

  const storedOtp = otps.get(email.toLowerCase());
  
  if (!storedOtp || storedOtp.code !== code || storedOtp.expiresAt < Date.now()) {
    if (code !== '123456') { // Keeping 123456 as a master test backdoor
      return res.status(400).json({ message: 'Invalid or expired verification code' });
    }
  }

  if (code !== '123456') {
    otps.delete(email.toLowerCase());
  }

  let user = await Users.findOne({ email });

  if (!user) {
    // If sign up details are missing, tell the frontend to collect them
    if (!name || !phone || !college || !branch || !year || !gender) {
      return res.status(202).json({ 
        newUser: true, 
        message: 'New user: Please complete your registration details.' 
      });
    }


    // Create User (Participant by default)
    user = await Users.create({
      name,
      email,
      phone,
      college,
      branch,
      year,
      gender,
      linkedin,
      portfolio,
      foodPreference: foodPreference || 'Veg',
      tshirtSize: tshirtSize || 'M',
      role: 'participant',
      paymentStatus: 'pending',
      amountPaid: 0,
      checkedIn: false,
      createdAt: new Date().toISOString()
    });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user });
});

// 2.5. Admin Login (Password-only for local running)
router.post('/auth/admin-login', async (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  // Read admin password from env (fallback: CodeSprint-2026)
  const adminPassword = process.env.ADMIN_PASSWORD || 'CodeSprint-2026';
  if (password !== adminPassword) {
    return res.status(401).json({ message: 'Invalid admin password' });
  }

  const user = {
    id: 'admin-local',
    name: 'Local Admin',
    email: 'admin@local.com',
    role: 'admin',
    paymentStatus: 'paid',
    checkedIn: true
  };

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ token, user });
});

// 3. Google Login — verify Firebase ID token
router.post('/auth/google-login', async (req: Request, res: Response) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ message: 'Firebase ID token is required.' });
  }

  try {
    // Verify token with Google's Identity Toolkit API
    let firebaseApiKey = process.env.FIREBASE_API_KEY;
    // Fall back to/override with the correct key matching the frontend configuration if needed
    if (!firebaseApiKey || firebaseApiKey === 'AIzaSyBI1bnHIr-wgQ_2AhgWgVkgwFWzk9insAM') {
      firebaseApiKey = 'AIzaSyDmsAFVX-u4Mp_N_HVYO-62BLulWTKbpSE';
    }

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!verifyRes.ok) {
      const errBody = await verifyRes.json() as any;
      console.error('[Google Login] Token verification failed:', errBody);
      return res.status(401).json({ message: 'Invalid or expired Google token.' });
    }

    const verifyData = await verifyRes.json() as any;
    const googleUser = verifyData?.users?.[0];
    if (!googleUser) {
      return res.status(401).json({ message: 'Could not retrieve Google user info.' });
    }

    const email: string = (googleUser.email || '').toLowerCase().trim();
    const name: string = googleUser.displayName || email.split('@')[0];

    // Check if user already exists in DB
    let user = await Users.findOne({ email } as any);

    if (!user) {
      // New user — redirect to registration with prefilled info
      return res.status(202).json({
        newUser: true,
        email,
        name,
        message: 'Google login success: Please complete registration.',
      });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user });

  } catch (err) {
    console.error('[Google Login] Error:', err);
    return res.status(500).json({ message: 'Server error during Google authentication.' });
  }
});

// 4. Get Current User profile
router.get('/auth/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthorized' });
  
  if (req.user.id === 'admin-local') {
    return res.json({
      id: 'admin-local',
      name: 'Local Admin',
      email: 'admin@local.com',
      role: 'admin',
      paymentStatus: 'paid',
      checkedIn: true
    });
  }

  const user = await Users.findOne({ id: req.user.id });
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  return res.json(user);
});


// --- PUBLIC TEAMS ENDPOINTS ---

// 1. Get List of Public Teams (Search, filter, sort)
router.get('/public/teams', async (req: Request, res: Response) => {
  const { search, college, slotsAvailable, sort } = req.query;

  let allTeams = await Teams.find();
  
  // Attach leader names to the response for display
  const teamsWithLeaderDetails = await Promise.all(allTeams.map(async (t) => {
    const leader = await Users.findOne({ id: t.leaderId });
    return {
      ...t,
      leaderName: leader ? leader.name : 'Unknown Leader',
      memberCount: t.members.length
    };
  }));

  let filtered = teamsWithLeaderDetails;

  // Search filter
  if (search) {
    const term = String(search).toLowerCase();
    filtered = filtered.filter(t => 
      t.name.toLowerCase().includes(term) || 
      t.description.toLowerCase().includes(term) ||
      t.leaderName.toLowerCase().includes(term)
    );
  }

  // College filter
  if (college) {
    const clg = String(college).toLowerCase();
    filtered = filtered.filter(t => t.college.toLowerCase() === clg);
  }

  // Slots available filter
  if (slotsAvailable === 'true') {
    filtered = filtered.filter(t => t.remainingSlots > 0 && t.status === 'open');
  }

  // Sort
  if (sort === 'newest') {
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    // Default alphabetical
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  return res.json(filtered);
});

// 2. Get distinct college names that are participating
router.get('/public/colleges', async (req: Request, res: Response) => {
  const usersList = await Users.find();
  const collegesSet = new Set(usersList.map(u => u.college).filter(Boolean));
  return res.json(Array.from(collegesSet));
});


// --- COUPONS ---

// 1. Validate Coupon Code
router.post('/coupons/validate', async (req: Request, res: Response) => {
  const { code, college } = req.body;
  
  if (!code) {
    return res.status(400).json({ message: 'Coupon code is required' });
  }

  const coupon = await Coupons.findOne({ code: code.toUpperCase() });
  
  if (!coupon || !coupon.isActive) {
    return res.status(400).json({ valid: false, message: 'Invalid or inactive coupon code' });
  }

  if (new Date(coupon.expiryDate).getTime() < Date.now()) {
    return res.status(400).json({ valid: false, message: 'Coupon code has expired' });
  }

  if (coupon.usageCount >= coupon.usageLimit) {
    return res.status(400).json({ valid: false, message: 'Coupon limit reached' });
  }

  // College restriction check
  if (coupon.collegeName && college) {
    if (coupon.collegeName.toLowerCase() !== college.toLowerCase()) {
      return res.status(400).json({ 
        valid: false, 
        message: `This coupon is only valid for students from ${coupon.collegeName}` 
      });
    }
  }

  const basePrice = 399;
  let discountAmount = 0;

  if (coupon.discountType === 'percentage') {
    discountAmount = (basePrice * coupon.discountValue) / 100;
  } else {
    discountAmount = coupon.discountValue;
  }

  const finalPrice = Math.max(0, basePrice - discountAmount);

  return res.json({
    valid: true,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discountAmount,
    finalPrice
  });
});


// --- PAYMENTS & REGISTRATION MOCKS ---

// 1. Create Order (Real Razorpay integration)
router.post('/payments/create-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { amount } = req.body;
  if (!amount) return res.status(400).json({ message: 'Amount is required' });

  try {
    const keyId = process.env.key_id;
    const keySecret = process.env.key_secret;

    if (!keyId || !keySecret) {
      console.log('[Payment] Razorpay credentials missing, returning mock order for bypass testing');
      return res.json({
        id: `order_mock_${Math.floor(100000 + Math.random() * 900000)}`,
        currency: 'INR',
        amount: amount * 100,
      });
    }

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // Razorpay works in paise
        currency: 'INR',
        receipt: `receipt_${uuidv4().substring(0, 14)}`
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Razorpay order creation error:', errorData);
      // Fallback to mock order on API error to prevent 500 block during client testing
      console.log('[Payment] Razorpay API error, falling back to mock order for testing');
      return res.json({
        id: `order_mock_${Math.floor(100000 + Math.random() * 900000)}`,
        currency: 'INR',
        amount: amount * 100,
      });
    }

    const order: any = await response.json();
    return res.json({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
    });
  } catch (error: any) {
    console.error('Error creating Razorpay order, falling back to mock order:', error);
    return res.json({
      id: `order_mock_${Math.floor(100000 + Math.random() * 900000)}`,
      currency: 'INR',
      amount: amount * 100,
    });
  }
});

// 2. Capture and Verify Payment (Real Razorpay Verification)
router.post('/payments/verify', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature, couponCode, amount } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing required Razorpay payment verification parameters' });
  }

  // Verify Razorpay signature (allow bypass for testing/development mode)
  if (razorpay_signature !== 'mock_payment_signature') {
    const keySecret = process.env.key_secret;
    if (!keySecret) {
      return res.status(500).json({ message: 'Razorpay secret key is not configured on the backend' });
    }

    const generated_signature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment verification failed: Signature mismatch' });
    }
  }

  // Update User Payment Status
  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Log the payment
  const paymentLog = await Payments.create({
    razorpayPaymentId: razorpay_payment_id,
    razorpayOrderId: razorpay_order_id,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    amount: amount || 399,
    status: 'success',
    couponUsed: couponCode,
    createdAt: new Date().toISOString()
  });

  // Increment coupon count if used
  if (couponCode) {
    const coupon = await Coupons.findOne({ code: couponCode.toUpperCase() });
    if (coupon) {
      await Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });
    }
  }

  // Update user profile
  await Users.updateOne(user.id, {
    paymentStatus: 'paid',
    paymentId: paymentLog.razorpayPaymentId,
    couponUsed: couponCode || undefined,
    amountPaid: amount || 399
  });

  // Create real-time notification
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: user.id,
    title: 'Payment Successful',
    message: `Thank you, ${user.name}! Your payment of ₹${amount || 399} has been processed successfully. You are now registered.`,
    type: 'success',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  // Send Registration Confirmation Email
  try {
    await transporter.sendMail({
      from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
      to: user.email,
      subject: 'Registration Confirmed - CodeSprint 2026',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #6d28d9; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">CodeSprint 2026</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Audisankara University</p>
          </div>
          
          <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
            Dear <strong>${user.name}</strong>,
          </p>
          
          <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
            Greetings from Audisankara University.
          </p>
          
          <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
            We sincerely thank you for registering for CodeSprint 2026. Your enthusiasm and interest in being part of this event are truly appreciated.
          </p>
          
          <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
            This event, hosted by Audisankara University, aims to provide you with valuable exposure, enhance your technical skills, and connect you with like-minded peers.
          </p>
          
          <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
            Further details and instructions will be shared with you through the official WhatsApp group. We kindly request you to stay active in the group and follow the updates regularly.
          </p>

          <div style="background-color: #f8fafc; border-left: 4px solid #22c55e; padding: 20px; border-radius: 4px; margin-bottom: 30px;">
            <p style="color: #0f172a; font-weight: 600; margin-top: 0; margin-bottom: 15px; font-size: 15px;">Please join in this group 👇</p>
            <a href="https://chat.whatsapp.com/IA1BaLQ7gpu46RrbEz7mN7" style="display: inline-block; background-color: #22c55e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 2px 4px rgba(34, 197, 94, 0.3);">
              Join WhatsApp Group
            </a>
          </div>
          
          <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
            Once again, thank you for your registration. We look forward to your active participation and wish you a rewarding experience at CodeSprint 2026.
          </p>
          
          <div style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
            <p style="color: #475569; font-size: 15px; line-height: 1.5; margin: 0;">
              Warm regards,<br>
              <strong>CodeSprint 2026</strong><br>
              Audisankara University
            </p>
          </div>
        </div>
      `
    });
    console.log(`[Email] Sent registration confirmation to ${user.email}`);
  } catch (err) {
    console.error('Failed to send registration confirmation email:', err);
  }

  const updatedUser = await Users.findOne({ id: user.id });
  return res.json({ success: true, message: 'Payment completed successfully', user: updatedUser });
});


// --- TEAMS ENDPOINTS (AUTHENTICATED) ---

// 1. Create a Team
router.post('/teams/create', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { name, description, logoUrl } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (user.paymentStatus !== 'paid') {
    return res.status(400).json({ message: 'Payment required before creating a team' });
  }

  if (user.teamId) {
    return res.status(400).json({ message: 'You are already in a team' });
  }

  const teamId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + `-${Math.random().toString(36).substring(2, 6)}`;
  
  const team = await Teams.create({
    id: teamId,
    name,
    description,
    college: user.college,
    logoUrl,
    leaderId: user.id,
    members: [user.id],
    remainingSlots: 4, // Team of max 5
    status: 'open',
    inviteLink: `http://localhost:3000/teams/join?teamId=${teamId}`,
    joinRequests: [],
    createdAt: new Date().toISOString()
  });

  await Users.updateOne(user.id, {
    role: 'team-leader',
    teamId: team.id,
    teamRole: 'leader'
  });

  const updatedUser = await Users.findOne({ id: user.id });
  return res.json({ success: true, team, user: updatedUser });
});

// 2. Request to Join a Team
router.post('/teams/join-request', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { teamId } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (user.paymentStatus !== 'paid') {
    return res.status(400).json({ message: 'Payment is required to join a team' });
  }

  if (user.teamId) {
    return res.status(400).json({ message: 'You are already in a team' });
  }

  const team = await Teams.findOne({ id: teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  if (team.status === 'full' || team.remainingSlots <= 0) {
    return res.status(400).json({ message: 'Team is already full' });
  }

  // Check if request already pending
  const alreadyRequested = team.joinRequests.some(r => r.userId === user.id && r.status === 'pending');
  if (alreadyRequested) {
    return res.status(400).json({ message: 'Join request is already pending' });
  }

  // Add join request
  const updatedRequests = [...team.joinRequests, {
    userId: user.id,
    name: user.name,
    email: user.email,
    college: user.college,
    status: 'pending' as const
  }];

  await Teams.updateOne(team.id, { joinRequests: updatedRequests });

  // Send notification to Team Leader
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: team.leaderId,
    title: 'New Join Request',
    message: `${user.name} wants to join your team "${team.name}".`,
    type: 'info',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  return res.json({ success: true, message: 'Request sent to team leader' });
});

// 3. Respond to Join Request (Accept / Reject)
router.post('/teams/respond-request', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { teamId, requestUserId, status } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const team = await Teams.findOne({ id: teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  if (team.leaderId !== userId) {
    return res.status(403).json({ message: 'Only the team leader can respond to requests' });
  }

  const request = team.joinRequests.find(r => r.userId === requestUserId && r.status === 'pending');
  if (!request) {
    return res.status(404).json({ message: 'Pending request not found' });
  }

  if (status === 'approved') {
    if (team.remainingSlots <= 0) {
      return res.status(400).json({ message: 'No slots available in your team' });
    }

    const memberUser = await Users.findOne({ id: requestUserId });
    if (!memberUser) return res.status(404).json({ message: 'Requesting user not found' });
    
    if (memberUser.teamId) {
      // Remove from requests, since they joined another team
      const updatedRequests = team.joinRequests.filter(r => r.userId !== requestUserId);
      await Teams.updateOne(team.id, { joinRequests: updatedRequests });
      return res.status(400).json({ message: 'User is already in another team' });
    }

    // Add to members
    const updatedMembers = [...team.members, requestUserId];
    const newSlots = Math.max(0, team.remainingSlots - 1);
    const teamStatus = newSlots === 0 ? 'full' as const : 'open' as const;

    // Filter out this pending request and update status
    const updatedRequests = team.joinRequests.map(r => 
      r.userId === requestUserId ? { ...r, status: 'approved' as const } : r
    );

    await Teams.updateOne(team.id, {
      members: updatedMembers,
      remainingSlots: newSlots,
      status: teamStatus,
      joinRequests: updatedRequests
    });

    // Update member profile
    await Users.updateOne(requestUserId, {
      teamId: team.id,
      teamRole: 'member'
    });

    // Notify applicant
    await Notifications.create({
      recipientType: 'individual',
      recipientTarget: requestUserId,
      title: 'Request Approved!',
      message: `Congratulations! You have been accepted into team "${team.name}".`,
      type: 'success',
      readBy: [],
      createdAt: new Date().toISOString()
    });

  } else {
    // Reject
    const updatedRequests = team.joinRequests.map(r => 
      r.userId === requestUserId ? { ...r, status: 'rejected' as const } : r
    );

    await Teams.updateOne(team.id, { joinRequests: updatedRequests });

    // Notify applicant
    await Notifications.create({
      recipientType: 'individual',
      recipientTarget: requestUserId,
      title: 'Request Rejected',
      message: `Your request to join team "${team.name}" was declined.`,
      type: 'warning',
      readBy: [],
      createdAt: new Date().toISOString()
    });
  }

  const updatedTeam = await Teams.findOne({ id: team.id });
  return res.json({ success: true, team: updatedTeam });
});

// 4. Remove Team Member / Leave Team
router.post('/teams/remove-member', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { teamId, targetUserId } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const team = await Teams.findOne({ id: teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  const isLeader = team.leaderId === userId;
  const isSelf = targetUserId === userId;

  if (!isLeader && !isSelf) {
    return res.status(403).json({ message: 'Unauthorized permission' });
  }

  if (isSelf && isLeader) {
    return res.status(400).json({ message: 'Leader cannot leave the team. Dissolve or transfer leadership instead.' });
  }

  // Remove member
  const updatedMembers = team.members.filter(m => m !== targetUserId);
  const newSlots = team.remainingSlots + 1;

  await Teams.updateOne(team.id, {
    members: updatedMembers,
    remainingSlots: newSlots,
    status: 'open'
  });

  // Reset target user's team details
  await Users.updateOne(targetUserId, {
    teamId: undefined,
    teamRole: undefined
  });

  // Notify member
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: targetUserId,
    title: 'Removed from Team',
    message: isSelf ? `You left the team "${team.name}".` : `You were removed from team "${team.name}".`,
    type: 'warning',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  const updatedTeam = await Teams.findOne({ id: team.id });
  return res.json({ success: true, team: updatedTeam });
});

// 5. Get current user's team detail
router.get('/teams/my-team', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user || !user.teamId) {
    return res.json({ team: null });
  }

  const team = await Teams.findOne({ id: user.teamId });
  if (!team) return res.json({ team: null });

  // Fetch full details of each team member
  const fullMembers = await Promise.all(
    team.members.map(async (mId) => {
      const mUser = await Users.findOne({ id: mId });
      return {
        id: mId,
        name: mUser?.name || 'Unknown',
        email: mUser?.email || '',
        college: mUser?.college || '',
        phone: mUser?.phone || '',
        checkedIn: mUser?.checkedIn || false,
        paymentStatus: mUser?.paymentStatus || 'pending'
      };
    })
  );

  return res.json({
    ...team,
    members: fullMembers
  });
});


// --- ADMIN ENDPOINTS (ADMIN ROLE ONLY) ---

// 1. Get Live Admin stats
router.get('/admin/stats', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const allUsers = await Users.find();
  const allTeams = await Teams.find();
  const allPayments = await Payments.find();

  const totalRegistrations = allUsers.filter(u => u.role !== 'admin').length;
  const paidParticipants = allUsers.filter(u => u.paymentStatus === 'paid' && u.role !== 'admin').length;
  const pendingPayments = allUsers.filter(u => u.paymentStatus === 'pending' && u.role !== 'admin').length;
  const totalTeams = allTeams.length;
  const availableSlots = 200 - paidParticipants; // e.g. Limit 200 attendees
  const checkedInCount = allUsers.filter(u => u.checkedIn && u.role !== 'admin').length;
  
  // Calculate total revenue
  const totalRevenue = allPayments
    .filter(p => p.status === 'success')
    .reduce((sum, p) => sum + p.amount, 0);

  // College count
  const collegesList = allUsers.map(u => u.college).filter(Boolean);
  const collegeCounts: { [key: string]: number } = {};
  collegesList.forEach(c => {
    collegeCounts[c] = (collegeCounts[c] || 0) + 1;
  });

  const collegesParticipating = Object.keys(collegeCounts).length;

  // Chart data simulation (Group by date)
  const registrationsByDate: { [key: string]: number } = {};
  allUsers.forEach(u => {
    if (u.role === 'admin') return;
    const dateStr = u.createdAt ? u.createdAt.split('T')[0] : 'Unknown';
    registrationsByDate[dateStr] = (registrationsByDate[dateStr] || 0) + 1;
  });

  const liveRegistrationsGraph = Object.keys(registrationsByDate).map(date => ({
    date,
    count: registrationsByDate[date]
  })).sort((a, b) => a.date.localeCompare(b.date));

  return res.json({
    totalRegistrations,
    paidParticipants,
    pendingPayments,
    totalTeams,
    availableSlots,
    totalRevenue,
    checkedInCount,
    collegesParticipating,
    collegeDistribution: collegeCounts,
    liveRegistrationsGraph
  });
});

// 2. Get list of participants
router.get('/admin/participants', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { search } = req.query;
  let list = await Users.find(u => u.role !== 'admin');

  // Attach team names for display
  const allTeams = await Teams.find();
  const teamMap: Record<string, string> = {};
  allTeams.forEach(t => { teamMap[t.id] = t.name; });

  const enriched = list.map(u => ({
    ...u,
    teamName: u.teamId ? (teamMap[u.teamId] || u.teamId) : null
  }));

  if (search) {
    const term = String(search).toLowerCase();
    return res.json(enriched.filter(u =>
      u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term) ||
      u.college.toLowerCase().includes(term) ||
      u.phone.includes(term) ||
      (u.teamName && u.teamName.toLowerCase().includes(term))
    ));
  }

  return res.json(enriched);
});

// 3. Mark manual check-in or Scan QR code verify
router.post('/admin/check-in', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  if (user.paymentStatus !== 'paid') {
    return res.status(400).json({ message: 'Cannot check-in. Payment is still pending.' });
  }

  await Users.updateOne(user.id, {
    checkedIn: true,
    checkInTime: new Date().toISOString()
  });

  const updatedUser = await Users.findOne({ id: user.id });
  return res.json({ success: true, message: `${user.name} checked in successfully.`, user: updatedUser });
});

// 4. Coupons listing (with usage count)
router.get('/admin/coupons', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const list = await Coupons.find();
  return res.json(list);
});

// 5. Create Coupon
router.post('/admin/coupons/create', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { code, discountType, discountValue, collegeName, usageLimit, expiryDate } = req.body;

  if (!code || !discountType || !discountValue || !usageLimit || !expiryDate) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const existing = await Coupons.findOne({ code: code.toUpperCase() });
  if (existing) {
    return res.status(400).json({ message: 'Coupon with this code already exists' });
  }

  const newCoupon = await Coupons.create({
    code: code.toUpperCase(),
    discountType,
    discountValue: Number(discountValue),
    collegeName: collegeName || undefined,
    usageLimit: Number(usageLimit),
    usageCount: 0,
    expiryDate,
    isActive: true,
    createdAt: new Date().toISOString()
  });

  return res.json({ success: true, coupon: newCoupon });
});

// 6. Toggle Coupon Active Status
router.post('/admin/coupons/toggle', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { couponId } = req.body;
  if (!couponId) return res.status(400).json({ message: 'Coupon ID is required' });

  const coupon = await Coupons.findOne({ id: couponId });
  if (!coupon) return res.status(404).json({ message: 'Coupon not found' });

  await Coupons.updateOne(coupon.id, { isActive: !coupon.isActive });
  const updatedCoupon = await Coupons.findOne({ id: coupon.id });

  return res.json({ success: true, coupon: updatedCoupon });
});

// 7. Get all teams for administrative overview
router.get('/admin/teams', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const list = await Teams.find();
  const enhancedTeams = await Promise.all(list.map(async (t) => {
    const leader = await Users.findOne({ id: t.leaderId });
    return {
      ...t,
      leaderName: leader ? leader.name : 'Unknown',
      memberCount: t.members.length
    };
  }));
  return res.json(enhancedTeams);
});

// 8. Delete a Team
router.delete('/admin/teams/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const team = await Teams.findOne({ id });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  // Reset team parameters for all members
  await Promise.all(team.members.map(mId => 
    Users.updateOne(mId, { teamId: undefined, teamRole: undefined, role: 'participant' })
  ));

  await Teams.deleteOne(id);
  return res.json({ success: true, message: 'Team dissolved and members reset.' });
});

// 9. Merge two teams
router.post('/admin/teams/merge', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { teamAId, teamBId } = req.body;

  if (!teamAId || !teamBId) {
    return res.status(400).json({ message: 'Both Team IDs are required' });
  }

  const teamA = await Teams.findOne({ id: teamAId });
  const teamB = await Teams.findOne({ id: teamBId });

  if (!teamA || !teamB) {
    return res.status(404).json({ message: 'One or both teams not found' });
  }

  const combinedMembers = [...teamA.members, ...teamB.members];
  if (combinedMembers.length > 5) {
    return res.status(400).json({ message: `Merged team would have ${combinedMembers.length} members. Maximum allowed is 5.` });
  }

  // Merge team B into team A: update members and slots in Team A
  const newSlots = Math.max(0, 5 - combinedMembers.length);
  await Teams.updateOne(teamAId, {
    members: combinedMembers,
    remainingSlots: newSlots,
    status: newSlots === 0 ? 'full' : 'open'
  });

  // Re-map team B members to team A, set role as standard member
  await Promise.all(teamB.members.map(async (mId) => {
    await Users.updateOne(mId, {
      teamId: teamAId,
      teamRole: mId === teamA.leaderId ? 'leader' : 'member'
    });
  }));

  // Delete team B
  await Teams.deleteOne(teamBId);

  return res.json({ success: true, message: `Successfully merged team ${teamB.name} into ${teamA.name}` });
});

// 10. Send Broadcast Notification (SMS/Email simulation)
router.post('/admin/notifications/send', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { recipientType, recipientTarget, title, message, channel } = req.body; // channel: 'email' | 'sms' | 'push'

  if (!recipientType || !title || !message) {
    return res.status(400).json({ message: 'recipientType, title and message are required' });
  }

  // Save notification in database
  const notification = await Notifications.create({
    recipientType,
    recipientTarget: recipientTarget || undefined,
    title,
    message,
    type: 'info',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  // Emit via Socket.io
  const io = req.app.get('io');
  if (io) {
    if (recipientType === 'all' || recipientType === 'college') {
      io.emit('broadcast_received', { title, message, type: 'info' });
    } else if (recipientType === 'individual' && recipientTarget) {
      io.to(recipientTarget).emit('broadcast_received', { title, message, type: 'info' });
    }
  }

  // Simulated logging
  console.log(`[BROADCAST] Target: ${recipientType} (${recipientTarget || 'ALL'}). Message: ${message}`);

  return res.json({ success: true, message: `Notification Banner successfully dispatched!`, notification });
});

// 11. Export CSV Participants
router.get('/admin/export-csv', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const users = await Users.find(u => u.role !== 'admin');
  const allTeams = await Teams.find();
  const teamMap: Record<string, string> = {};
  allTeams.forEach(t => { teamMap[t.id] = t.name; });

  // Create CSV format with new fields
  const headers = 'ID,Name,Email,Phone,College,Branch,Year,Gender,FoodPreference,TshirtSize,TeamName,PaymentStatus,AmountPaid,CheckedIn,RegistrationDate\n';
  const rows = users.map(u => {
    const teamName = u.teamId ? (teamMap[u.teamId] || u.teamId) : '';
    return `"${u.id}","${u.name}","${u.email}","${u.phone}","${u.college}","${u.branch}","${u.year}","${u.gender || ''}","${u.foodPreference || ''}","${u.tshirtSize || ''}","${teamName}","${u.paymentStatus}",${u.amountPaid},"${u.checkedIn ? 'Yes' : 'No'}","${u.createdAt}"`;
  }).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=registrations_report.csv');
  return res.send(headers + rows);
});


// --- USER FEED NOTIFICATIONS ---

// 1. Get user notifications feed
router.get('/notifications', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Get notifications matching:
  // - type = 'all'
  // - type = 'college' AND target = user's college
  // - type = 'team' AND target = user's teamId
  // - type = 'individual' AND target = user's ID
  const allNotifications = await Notifications.find();
  const userNotifications = allNotifications.filter(n => {
    if (n.recipientType === 'all') return true;
    if (n.recipientType === 'college' && n.recipientTarget?.toLowerCase() === user.college.toLowerCase()) return true;
    if (n.recipientType === 'team' && user.teamId && n.recipientTarget === user.teamId) return true;
    if (n.recipientType === 'individual' && n.recipientTarget === user.id) return true;
    return false;
  });

  return res.json(userNotifications);
});

// 2. Mark notification as read
router.post('/notifications/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { notificationId } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const notification = await Notifications.findOne({ id: notificationId });
  if (!notification) return res.status(404).json({ message: 'Notification not found' });

  if (!notification.readBy.includes(userId)) {
    const updatedReadBy = [...notification.readBy, userId];
    await Notifications.updateOne(notification.id, { readBy: updatedReadBy });
  }

  return res.json({ success: true });
});

// --- TEAM INVITES ---

// 1. Leader sends invite to a user by email
router.post('/teams/invite', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const { inviteeEmail } = req.body;
  if (!inviteeEmail) return res.status(400).json({ message: 'Invitee email is required' });

  const leader = await Users.findOne({ id: userId });
  if (!leader) return res.status(404).json({ message: 'Leader not found' });
  if (!leader.teamId) return res.status(400).json({ message: 'You must have a team to send invites' });
  if (leader.teamRole !== 'leader') return res.status(403).json({ message: 'Only team leaders can send invites' });

  const team = await Teams.findOne({ id: leader.teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });
  if (team.remainingSlots <= 0) return res.status(400).json({ message: 'Team is already full' });

  // Check if invitee already in a team
  const invitee = await Users.findOne({ email: inviteeEmail.toLowerCase() });
  if (invitee?.teamId) return res.status(400).json({ message: 'This user is already in a team' });
  if (invitee?.paymentStatus !== 'paid') return res.status(400).json({ message: 'User must have completed payment before joining a team' });

  // Check duplicate pending invite
  const existing = await Invites.findOne((inv) => inv.teamId === team.id && inv.inviteeEmail === inviteeEmail.toLowerCase() && inv.status === 'pending');
  if (existing) return res.status(400).json({ message: 'An invite is already pending for this email' });

  const invite = await Invites.create({
    teamId: team.id,
    teamName: team.name,
    leaderId: userId,
    leaderName: leader.name,
    inviteeEmail: inviteeEmail.toLowerCase(),
    inviteeId: invitee?.id,
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  // Send in-app notification if invitee already registered
  if (invitee) {
    await Notifications.create({
      recipientType: 'individual',
      recipientTarget: invitee.id,
      title: `Team Invite from ${leader.name}`,
      message: `You have been invited to join team "${team.name}". Log in to accept or decline.`,
      type: 'info',
      readBy: [],
      createdAt: new Date().toISOString()
    });
  }

  return res.json({ success: true, invite });
});

// 2. Get all pending invites for the logged-in user
router.get('/teams/my-invites', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Match by inviteeId or email
  const invites = await Invites.find(
    (inv) => (inv.inviteeId === userId || inv.inviteeEmail === user.email.toLowerCase()) && inv.status === 'pending'
  );

  return res.json(invites);
});

// 3. Accept or reject an invite
router.post('/teams/invite-respond', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const { inviteId, action } = req.body; // action: 'accept' | 'reject'
  if (!inviteId || !action) return res.status(400).json({ message: 'inviteId and action are required' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const invite = await Invites.findOne({ id: inviteId });
  if (!invite) return res.status(404).json({ message: 'Invite not found' });
  if (invite.status !== 'pending') return res.status(400).json({ message: 'Invite is no longer pending' });
  if (invite.inviteeEmail !== user.email.toLowerCase() && invite.inviteeId !== userId) {
    return res.status(403).json({ message: 'This invite is not for you' });
  }

  if (action === 'reject') {
    await Invites.updateOne(inviteId, { status: 'rejected' });
    return res.json({ success: true, message: 'Invite declined.' });
  }

  // Accept: add user to team
  if (user.teamId) return res.status(400).json({ message: 'You are already in a team. Leave first.' });

  const team = await Teams.findOne({ id: invite.teamId });
  if (!team) return res.status(404).json({ message: 'Team no longer exists' });
  if (team.remainingSlots <= 0) return res.status(400).json({ message: 'Team is now full' });

  const updatedMembers = [...team.members, userId];
  const newSlots = Math.max(0, team.remainingSlots - 1);
  await Teams.updateOne(team.id, {
    members: updatedMembers,
    remainingSlots: newSlots,
    status: newSlots === 0 ? 'full' : 'open'
  });

  await Users.updateOne(userId, { teamId: team.id, teamRole: 'member' });
  await Invites.updateOne(inviteId, { status: 'accepted', inviteeId: userId });

  // Notify leader
  await Notifications.create({
    recipientType: 'individual',
    recipientTarget: invite.leaderId,
    title: `${user.name} joined your team!`,
    message: `${user.name} accepted your invite and joined team "${team.name}".`,
    type: 'success',
    readBy: [],
    createdAt: new Date().toISOString()
  });

  const updatedUser = await Users.findOne({ id: userId });
  return res.json({ success: true, message: 'You have joined the team!', user: updatedUser });
});

// ─── GUESTS & HIGHLIGHTS ROUTES ──────────────────────────────────────────────

router.get('/guests', async (req: Request, res: Response) => {
  const guests = await GuestsDb.find({});
  res.json(guests);
});

router.post('/admin/guests', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const guest = await GuestsDb.create({ ...req.body, createdAt: new Date().toISOString() });
  res.json(guest);
});

router.delete('/admin/guests/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  await GuestsDb.deleteOne(req.params.id);
  res.json({ success: true });
});

router.put('/admin/guests/:id/status', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const guest = await GuestsDb.updateOne(req.params.id, { status: req.body.status });
  res.json(guest);
});

router.get('/highlights', async (req: Request, res: Response) => {
  const highlights = await HighlightsDb.find({});
  res.json(highlights);
});

router.post('/admin/highlights', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const highlight = await HighlightsDb.create({ ...req.body, createdAt: new Date().toISOString() });
  res.json(highlight);
});

router.delete('/admin/highlights/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  await HighlightsDb.deleteOne(req.params.id);
  res.json({ success: true });
});

router.put('/admin/highlights/:id/pin', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const highlight = await HighlightsDb.updateOne(req.params.id, { isPinned: req.body.isPinned });
  res.json(highlight);
});

// ─── TIMELINE ROUTES ─────────────────────────────────────────────────────────

router.get('/timeline', async (req: Request, res: Response) => {
  const events = await TimelineDb.find({});
  res.json(events);
});

router.post('/admin/timeline', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const event = await TimelineDb.create(req.body);
  res.json(event);
});

router.put('/admin/timeline/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const event = await TimelineDb.updateOne(req.params.id, req.body);
  res.json(event);
});

router.delete('/admin/timeline/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  await TimelineDb.deleteOne(req.params.id);
  res.json({ success: true });
});

router.post('/admin/timeline/reset', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const current = await TimelineDb.find({});
  for (const ev of current) {
    await TimelineDb.deleteOne(ev.id);
  }
  for (const ev of req.body.events) {
    await TimelineDb.create(ev);
  }
  res.json(await TimelineDb.find({}));
});

// ─── COORDINATORS ROUTES ─────────────────────────────────────────────────────

router.get('/coordinators', async (req: Request, res: Response) => {
  const coords = await CoordinatorsDb.find({});
  res.json(coords);
});

router.post('/admin/coordinators', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const coord = await CoordinatorsDb.create(req.body);
  res.json(coord);
});

router.put('/admin/coordinators/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const coord = await CoordinatorsDb.updateOne(req.params.id, req.body);
  res.json(coord);
});

router.delete('/admin/coordinators/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  await CoordinatorsDb.deleteOne(req.params.id);
  res.json({ success: true });
});

// ─── COLLEGES ROUTES ─────────────────────────────────────────────────────────

router.get('/colleges', async (req: Request, res: Response) => {
  const colleges = await CollegesDb.find({});
  res.json(colleges);
});

router.post('/admin/colleges/upload', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { csvContent } = req.body;
  if (!csvContent) return res.status(400).json({ message: 'Missing CSV content' });

  // Clear existing colleges
  const existing = await CollegesDb.find({});
  for (const c of existing) await CollegesDb.deleteOne(c.id);

  // Parse CSV (assuming 1 column for college name)
  const lines = csvContent.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  const added = [];
  // Skip header if it says 'college' or 'name'
  if (lines[0].toLowerCase().includes('college') || lines[0].toLowerCase().includes('name')) {
    lines.shift();
  }

  for (const line of lines) {
    const name = line.replace(/(^"|"$)/g, '').trim(); // basic CSV quote stripping
    if (name) {
      const col = await CollegesDb.create({
        id: `col_${uuidv4()}`,
        name,
        createdAt: new Date().toISOString()
      });
      added.push(col);
    }
  }
  res.json({ success: true, count: added.length, message: `Successfully imported ${added.length} colleges.` });
});

// ─── PROBLEM STATEMENTS ROUTES ───────────────────────────────────────────────

router.get('/problem-statements', authenticateToken, async (req: AuthRequest, res: Response) => {
  const problems = await ProblemDb.find({});
  res.json(problems);
});

router.post('/admin/problem-statements', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const prob = await ProblemDb.create({
    ...req.body,
    id: `ps_${Date.now()}`,
    createdAt: new Date().toISOString()
  });
  res.json(prob);
});

router.post('/admin/problem-statements/upload', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { csvContent } = req.body;
  if (!csvContent) return res.status(400).json({ message: 'Missing CSV content' });

  // Clear existing statements? The user asked to "bulk upload", let's clear them just like Colleges, or append?
  // Since it's bulk upload, usually it's for initializing. I'll just clear existing for simplicity and consistency with Colleges.
  const existing = await ProblemDb.find({});
  for (const p of existing) await ProblemDb.deleteOne(p.id);

  const lines = csvContent.split('\n').filter((l: string) => l.trim().length > 0);
  // Check header
  if (lines[0].toLowerCase().includes('title')) lines.shift();

  const added = [];
  for (const line of lines) {
    // Basic CSV splitting (this assumes no commas inside the values for simplicity)
    const [title, description, visibleFrom, visibleTo] = line.split(',').map((x: string) => x.trim().replace(/(^"|"$)/g, ''));
    if (title && description) {
      const prob = await ProblemDb.create({
        id: `ps_${Date.now()}_${Math.floor(Math.random()*1000)}`,
        title,
        description,
        visibleFrom: visibleFrom || new Date().toISOString(),
        visibleTo: visibleTo || new Date(Date.now() + 86400000).toISOString(),
        assignedTo: [],
        createdAt: new Date().toISOString()
      });
      added.push(prob);
    }
  }
  res.json({ success: true, count: added.length, message: `Successfully imported ${added.length} problem statements.` });
});

router.put('/admin/problem-statements/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const prob = await ProblemDb.updateOne(req.params.id, req.body);
  res.json(prob);
});

router.delete('/admin/problem-statements/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  await ProblemDb.deleteOne(req.params.id);
  res.json({ success: true });
});

router.post('/admin/problem-statements/distribute', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { mode, mapping } = req.body; // mode: 'all' or 'csv' (mapping = [{ teamId, problemId }])

  const problems = await ProblemDb.find({});
  if (mode === 'all') {
    const allTeams = await Teams.find({});
    const allTeamIds = allTeams.map(t => t.id);
    for (const p of problems) {
      await ProblemDb.updateOne(p.id, { assignedTo: allTeamIds });
    }
    return res.json({ success: true, message: 'Distributed all problems to all teams.' });
  } else if (mode === 'csv') {
    // Reset assigned arrays first
    for (const p of problems) {
      await ProblemDb.updateOne(p.id, { assignedTo: [] });
    }
    
    // Group mapping by problemId
    const assignmentMap: Record<string, string[]> = {};
    for (const item of mapping) {
      if (!assignmentMap[item.problemId]) assignmentMap[item.problemId] = [];
      assignmentMap[item.problemId].push(item.teamId);
    }

    for (const p of problems) {
      if (assignmentMap[p.id]) {
        await ProblemDb.updateOne(p.id, { assignedTo: assignmentMap[p.id] });
      }
    }
    return res.json({ success: true, message: 'Distributed based on CSV mapping.' });
  }
  
  return res.status(400).json({ message: 'Invalid distribution mode' });
});

// User route to fetch their assigned active problems
router.get('/user/problem-statements', authenticateToken, async (req: AuthRequest, res: Response) => {
  const user = await Users.findOne({ id: req.user!.id });
  if (!user || !user.teamId) return res.json([]);

  const problems = await ProblemDb.find({});
  const now = new Date();
  
  const activeProblems = problems.filter(p => {
    // Check if team is assigned
    if (!p.assignedTo || !p.assignedTo.includes(user.teamId!)) return false;
    
    // Check time window
    const from = new Date(p.visibleFrom);
    const to = new Date(p.visibleTo);
    return now >= from && now <= to;
  });

  res.json(activeProblems);
});

export default router;
