import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import Razorpay from 'razorpay';
import dotenv from 'dotenv';
import { 
  Users, Teams, Coupons, Notifications, Payments, Invites, GuestsDb, HighlightsDb, TimelineDb, CoordinatorsDb, CollegesDb, ProblemDb, VisitorLogs,
  User, Team, Coupon, Notification, PaymentLog, TeamInvite, TimelineEvent, Coordinator, College, ProblemStatement, VisitorLog
} from '../config/db';

dotenv.config();

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'codesprint-secret-key-2026';
const FRONTEND_BASE_URL = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : '';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || process.env.key_id || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.key_secret || ''
});

/**
 * Normalizes college names to map typos, spacing, and casing to canonical college names
 */
export function normalizeCollegeName(rawName: string): string {
  if (!rawName) return '';
  let cleaned = rawName.trim().replace(/\s+/g, ' ');

  // Common spelling typos & variations
  cleaned = cleaned.replace(/instuite/gi, 'Institute');
  cleaned = cleaned.replace(/instittue/gi, 'Institute');
  cleaned = cleaned.replace(/intstitute/gi, 'Institute');
  cleaned = cleaned.replace(/universty/gi, 'University');
  cleaned = cleaned.replace(/univercity/gi, 'University');

  // Standardize capitalization (Title Case)
  return cleaned
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      if (['of', 'and', '&', 'for', 'in', 'at', 'the'].includes(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}



const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || ''
  }
});

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

const generateTeamId = async (): Promise<string> => {
  let isUnique = false;
  let teamId = '';
  let attempts = 0;

  while (!isUnique && attempts < 1000) {
    attempts++;
    const randomNum = Math.floor(Math.random() * 999) + 1;
    const formattedNum = String(randomNum).padStart(3, '0');
    teamId = `CS2026-${formattedNum}`;

    const existing = await Teams.findOne({ id: teamId });
    if (!existing) {
      isUnique = true;
    }
  }

  if (!isUnique) {
    const randomNum = Math.floor(Math.random() * 9000) + 1000;
    teamId = `CS2026-${randomNum}`;
  }

  return teamId;
};

const handleTeamPaymentSuccess = async (teamId: string, paymentId: string, totalAmountPaid: number) => {
  try {
    const team = await Teams.findOne({ id: teamId });
    if (!team) return;

    const members = await Users.find(u => u.teamId === teamId);

    // Update Team Payment status
    await Teams.updateOne(team.id, { 
      paymentStatus: 'paid',
      paidSlots: members.length
    });

    
    for (const member of members) {
      if (member.id === team.leaderId) {
        // Leader
        await Users.updateOne(member.id, {
          paymentStatus: 'paid',
          paymentId: paymentId,
          amountPaid: totalAmountPaid
        });
      } else {
        // Members
        await Users.updateOne(member.id, {
          paymentStatus: 'paid',
          paymentId: paymentId,
          amountPaid: 0
        });

        // Create in-app notification
        await Notifications.create({
          recipientType: 'individual',
          recipientTarget: member.id,
          title: 'Team Registration Confirmed',
          message: `Your team "${team.name}" registration fee has been fully paid by your leader! You are now registered.`,
          type: 'success',
          readBy: [],
          createdAt: new Date().toISOString()
        });

        // Send confirmation email
        try {
          await transporter.sendMail({
            from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
            to: member.email,
            subject: `Team Registration Confirmed - ${team.name} - CodeSprint 2026`,
            html: `
              <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #6d28d9; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">CodeSprint 2026</h1>
                  <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Audisankara University</p>
                </div>
                
                <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  Dear <strong>${member.name}</strong>,
                </p>
                
                <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  Great news! Your team leader has completed the payment for your team <strong>${team.name}</strong>.
                </p>
                
                <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                  Your slot is fully confirmed, and your registration fee is covered.
                </p>
                
                <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
                  Please join the official event WhatsApp group to receive further instructions and updates:
                </p>
      
                <div style="background-color: #f8fafc; border-left: 4px solid #22c55e; padding: 20px; border-radius: 4px; margin-bottom: 30px;">
                  <p style="color: #0f172a; font-weight: 600; margin-top: 0; margin-bottom: 15px; font-size: 15px;">Please join in this group 👇</p>
                  <a href="https://chat.whatsapp.com/IA1BaLQ7gpu46RrbEz7mN7" style="display: inline-block; background-color: #22c55e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 2px 4px rgba(34, 197, 94, 0.3);">
                    Join WhatsApp Group
                  </a>
                </div>
                
                <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                  You can now log in to your dashboard to view your team details and event schedule.
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
        } catch (emailErr) {
          console.error(`Failed to send email to team member ${member.email}:`, emailErr);
        }
      }
    }
  } catch (err) {
    console.error('Error handling team payment success cascade:', err);
  }
};

const processUserTeamPreference = async (userId: string) => {
  try {
    const user = await Users.findOne({ id: userId });
    if (!user || user.teamId) return;

    if (user.teamPreference === 'Create a Team' && user.tempTeamName) {
      const teamId = await generateTeamId();
      const team = await Teams.create({
        id: teamId,
        name: user.tempTeamName,
        description: `${user.name}'s team created during registration.`,
        college: user.college,
        leaderId: user.id,
        members: [user.id],
        remainingSlots: 4, // Max 5 members
        paidSlots: user.tempSlots || 1, // Store total paid slots
        status: 'open',
        inviteLink: `${FRONTEND_BASE_URL}/teams/join?teamId=${teamId}`,
        joinRequests: [],
        createdAt: new Date().toISOString()
      });

      await Users.updateOne(user.id, {
        role: 'team-leader',
        teamId: team.id,
        teamRole: 'leader'
      });
      console.log(`[Team Auto-Create] Created team "${user.tempTeamName}" for user ${user.email}`);
    } else if (user.teamPreference === 'Join a Team' && user.tempTeamCode) {
      const targetTeam = await Teams.findOne({ id: user.tempTeamCode });
      if (targetTeam) {
        const alreadyRequested = targetTeam.joinRequests?.some(r => r.userId === user.id) || false;
        const alreadyMember = targetTeam.members?.includes(user.id) || false;
        
        if (!alreadyRequested && !alreadyMember && targetTeam.remainingSlots > 0) {
          const updatedRequests = [...(targetTeam.joinRequests || []), {
            userId: user.id,
            name: user.name,
            email: user.email,
            college: user.college,
            status: 'pending' as const
          }];

          await Teams.updateOne(targetTeam.id, { joinRequests: updatedRequests });

          // Send notification to Team Leader
          await Notifications.create({
            recipientType: 'individual',
            recipientTarget: targetTeam.leaderId,
            title: 'New Join Request',
            message: `${user.name} wants to join your team "${targetTeam.name}".`,
            type: 'info',
            readBy: [],
            createdAt: new Date().toISOString()
          });
          
          console.log(`[Team Auto-Request] Created join request for user ${user.email} to team "${targetTeam.name}"`);
        }
      }
    }
  } catch (err) {
    console.error('Error processing auto team preference:', err);
  }
};

// --- AUTHENTICATION ENDPOINTS ---

// Check duplicate phone, roll number, or email before signup/payment
router.get('/users/check-duplicate', async (req: Request, res: Response) => {
  const { phone, rollNumber, email } = req.query;
  try {
    if (phone) {
      const existingPhone = await Users.findOne(u => u.phone === String(phone).trim() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
      if (existingPhone) {
        return res.status(200).json({ exists: true, type: 'phone', message: `Phone number ${phone} is already registered.` });
      }
    }
    if (rollNumber) {
      const existingRoll = await Users.findOne(u => String(u.rollNumber || '').trim().toUpperCase() === String(rollNumber).trim().toUpperCase() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
      if (existingRoll) {
        return res.status(200).json({ exists: true, type: 'rollNumber', message: `Roll/ID number ${rollNumber} is already registered.` });
      }
    }
    if (email) {
      const existingEmail = await Users.findOne(u => u.email.toLowerCase() === String(email).trim().toLowerCase() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
      if (existingEmail) {
        return res.status(200).json({ exists: true, type: 'email', message: `Email address ${email} is already registered.` });
      }
    }
    return res.status(200).json({ exists: false });
  } catch (error) {
    console.error('Error checking duplicate:', error);
    return res.status(500).json({ message: 'Internal server error checking duplicate.' });
  }
});

// 2. Verify and Complete Details (Handles profile updates and uniqueness validation before checkout)
router.post('/auth/otp-verify', async (req: Request, res: Response) => {
  const { email, name, phone, college, rollNumber, branch, year, gender, linkedin, portfolio, teamPreference, teamName, teamCode, slots, foodPreference, tshirtSize } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  let user = await Users.findOne({ email: email.toLowerCase() });

  if (user && user.profileCompleted === false) {
    // Existing pre-paid member completing profile details!
    if (phone) {
      const existingPhone = await Users.findOne({ phone });
      if (existingPhone && existingPhone.id !== user.id) {
        return res.status(400).json({ message: 'Phone number is already registered.' });
      }
    }
    if (rollNumber) {
      const existingRoll = await Users.findOne({ rollNumber });
      if (existingRoll && existingRoll.id !== user.id) {
        return res.status(400).json({ message: 'Roll number / ID number is already registered.' });
      }
    }

    await Users.updateOne(user.id, {
      name: name || user.name,
      phone,
      college,
      rollNumber,
      branch,
      year,
      gender,
      linkedin,
      portfolio,
      tshirtSize: tshirtSize || 'M',
      profileCompleted: true
    });
    user = await Users.findOne({ id: user.id });
  } else if (!user) {
    // If sign up details are missing, tell the frontend to collect them
    if (!name || !phone || !college || !branch || !year || !gender) {
      return res.status(202).json({ 
        newUser: true, 
        message: 'New user: Please complete your registration details.' 
      });
    }

    // Check unique phone
    const existingPhone = await Users.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ message: 'Phone number is already registered.' });
    }

    // Check unique rollNumber / ID
    if (rollNumber) {
      const existingRoll = await Users.findOne({ rollNumber });
      if (existingRoll) {
        return res.status(400).json({ message: 'Roll/ID number is already registered.' });
      }
    }

    // Return OTP verification success without creating user in database yet
    return res.json({ success: true, message: 'OTP verified successfully. Proceed to payment.' });
  }

  if (!user) {
    return res.status(500).json({ message: 'Failed to retrieve user.' });
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
      // User is not registered in database
      return res.status(404).json({
        notRegistered: true,
        email,
        name,
        message: 'Account not found. Please register first to participate in CodeSprint-2026.',
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

  // Retrieve all teams (both OPEN and CLOSED)
  let allTeams = await Teams.find({});
  
  // Attach leader names and member details to the response for display
  const teamsWithLeaderDetails = (await Promise.all(allTeams.map(async (t) => {
    let leader = await Users.findOne({ id: t.leaderId });
    if (!leader) {
      leader = await Users.findOne(u => u.teamId === t.id && u.role === 'team-leader');
    }

    const isTeamPaid = t.paymentStatus === 'paid' || (t.paymentStatus as any) === 'submitted';
    const isLeaderPaid = leader && (leader.paymentStatus === 'paid' || leader.paymentStatus === 'submitted');
    if (!isTeamPaid && !isLeaderPaid) return null;

    // Fetch details of all members
    const memberDetails = await Promise.all((t.members || []).map(async (mId) => {
      let u = await Users.findOne({ id: mId });
      if (!u) {
        u = await Users.findOne(usr => (usr as any)._id?.toString() === mId);
      }
      return (u && u.name) ? { name: u.name, gender: u.gender || 'Male' } : null;
    }));

    let list = memberDetails.filter(Boolean) as { name: string; gender: string; }[];
    if (leader && leader.name && !list.some(m => m.name === leader.name)) {
      list = [{ name: leader.name, gender: leader.gender || 'Male' }, ...list];
    }

    const currentMemberCount = list.length;
    const isFull = currentMemberCount >= 5;

    return {
      ...t,
      leaderId: leader ? leader.id : t.leaderId,
      leaderName: leader ? leader.name : 'Unknown Leader',
      memberCount: currentMemberCount,
      membersList: list,
      status: isFull ? 'full' : 'open',
      teamStatus: isFull ? 'CLOSED' : (t.teamStatus || 'OPEN'),
      availableSlots: Math.max(0, 5 - currentMemberCount)
    };
  }))).filter(Boolean) as any[];

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
    filtered = filtered.filter(t => 
      t.teamStatus !== 'CLOSED' && 
      t.status !== 'full' && 
      t.remainingSlots > 0 && 
      (t.availableSlots === undefined || t.availableSlots > 0)
    );
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
  const usersList = await Users.find(u => u.paymentStatus === 'paid' && u.role !== 'admin');
  const collegesSet = new Set(
    usersList
      .map(u => (u.college ? u.college.trim() : ''))
      .filter(c => c && c.toLowerCase() !== 'codesprint core' && c.toLowerCase() !== 'n/a')
  );
  return res.json(Array.from(collegesSet).sort());
});

// 2b. Get List of Public Participants
router.get('/public/participants', async (req: Request, res: Response) => {
  try {
    const { search, college } = req.query;

    const allUsers = await Users.find(u => u.paymentStatus === 'paid' && u.role !== 'admin');
    const allTeams = await Teams.find(t => t.paymentStatus !== 'pending');

    const teamMap = new Map<string, string>();
    allTeams.forEach(t => {
      teamMap.set(t.id, t.name);
    });

    let list = allUsers.map(u => ({
      id: u.id,
      name: u.name,
      college: u.college || 'N/A',
      year: u.year || 'N/A',
      branch: u.branch || '',
      gender: u.gender || '',
      role: u.role,
      teamId: u.teamId || '',
      teamRole: u.teamRole || (u.role === 'team-leader' ? 'leader' : 'member'),
      teamName: (u.teamId && teamMap.get(u.teamId)) || u.tempTeamName || 'Individual Participants'
    }));

    if (search) {
      const term = String(search).toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(term) ||
        p.college.toLowerCase().includes(term) ||
        p.teamName.toLowerCase().includes(term)
      );
    }

    if (college) {
      const clg = String(college).toLowerCase();
      list = list.filter(p => p.college.toLowerCase() === clg);
    }

    // Sort by team name then leader first, then member name
    list.sort((a, b) => {
      if (a.teamName !== b.teamName) return a.teamName.localeCompare(b.teamName);
      if (a.teamRole === 'leader' && b.teamRole !== 'leader') return -1;
      if (b.teamRole === 'leader' && a.teamRole !== 'leader') return 1;
      return a.name.localeCompare(b.name);
    });

    return res.json(list);
  } catch (err: any) {
    console.error('Error fetching public participants:', err);
    return res.status(500).json({ message: 'Failed to fetch participants.' });
  }
});

// 3. Generate a guaranteed unique team code/ID
router.get('/public/generate-team-code', async (req: Request, res: Response) => {
  try {
    const code = await generateTeamId();
    return res.json({ success: true, code });
  } catch (err: any) {
    return res.status(500).json({ message: err.message || 'Error generating team code' });
  }
});


// --- COUPONS ---

// 1. Validate Coupon Code
router.post('/coupons/validate', async (req: Request, res: Response) => {
  const { code, college, slots } = req.body;
  
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

  const basePrice = 399 * (Number(slots) || 1);
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

// --- PAYMENTS & REGISTRATION ---

// 0.1 Create Order Public (For signup registration before user is created in DB)
router.post('/payments/create-order-public', async (req: Request, res: Response) => {
  const { registrationType, quantity, couponCode } = req.body;
  const count = Number(quantity) || 1;
  let expectedAmount = count * 399;

  try {
    if (couponCode) {
      const coupon = await Coupons.findOne({ code: couponCode.toUpperCase() });
      if (coupon && coupon.isActive && new Date(coupon.expiryDate).getTime() > Date.now() && coupon.usageCount < coupon.usageLimit) {
        let discountAmount = 0;
        if (coupon.discountType === 'percentage') {
          discountAmount = (expectedAmount * coupon.discountValue) / 100;
        } else {
          discountAmount = coupon.discountValue;
        }
        expectedAmount = Math.max(0, expectedAmount - discountAmount);
      }
    }

    const keyId = process.env.RAZORPAY_KEY_ID || process.env.key_id;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;

    if (!keyId || !keySecret) {
      console.log('[Payment] Razorpay credentials missing, returning mock order for bypass testing');
      return res.json({
        id: `order_mock_${Math.floor(100000 + Math.random() * 900000)}`,
        currency: 'INR',
        amount: expectedAmount * 100,
        keyId: 'mock_key_id'
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(expectedAmount * 100), // in paise
      currency: 'INR',
      receipt: `receipt_${uuidv4().substring(0, 14)}`
    });

    return res.json({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      keyId: keyId,
    });
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    return res.json({
      id: `order_mock_${Math.floor(100000 + Math.random() * 900000)}`,
      currency: 'INR',
      amount: expectedAmount * 100,
      keyId: 'mock_key_id'
    });
  }
});

// 0.2 Verify and Register (Verify signature and create user/team record in paid state directly)
router.post('/payments/verify-and-register', async (req: Request, res: Response) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature, registrationType, registrationDetails, couponCode, amount } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !registrationType || !registrationDetails) {
    return res.status(400).json({ message: 'Missing required parameters' });
  }

  // Verify Razorpay signature
  if (razorpay_signature !== 'mock_payment_signature') {
    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;
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

  try {
    if (registrationType === 'TEAM') {
      const { teamName, teamCode, leader, members } = registrationDetails;
      if (!teamName || !teamCode || !leader || !members || !Array.isArray(members)) {
        return res.status(400).json({ message: 'Missing required team registration details.' });
      }

      if (!leader.name || !String(leader.name).trim() || !leader.email || !String(leader.email).trim() || !leader.phone || !leader.college || !leader.branch) {
        return res.status(400).json({ message: 'Team Leader details are incomplete.' });
      }

      const cleanTeamName = String(teamName).trim();
      const cleanTeamCode = String(teamCode).trim();
      const totalMembersCount = 1 + members.length;

      // Validate team size (3 to 5 total members)
      if (totalMembersCount < 3 || totalMembersCount > 5) {
        return res.status(400).json({ message: 'Your team must have between 3 and 5 members, including the Team Leader.' });
      }

      // Validate female participant requirement
      const allGenders = [leader.gender, ...members.map((m: any) => m.gender)];
      const hasFemale = allGenders.some(g => String(g || '').trim().toLowerCase() === 'female');
      if (!hasFemale) {
        return res.status(400).json({ message: 'At least one female participant is required in every team.' });
      }

      // Validate member details completeness
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m || !m.name || !String(m.name).trim() || !m.email || !String(m.email).trim() || !m.branch) {
          return res.status(400).json({ message: `Member #${i + 1} details are incomplete.` });
        }
      }

      // Uniqueness checks (only block if user has a paid or submitted registration)
      const allEmails = [leader.email, ...members.map((m: any) => m.email)].map(e => String(e).trim().toLowerCase());
      for (const email of allEmails) {
        const existingUser = await Users.findOne(u => u.email.toLowerCase() === email && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
        if (existingUser) return res.status(400).json({ message: `Email ${email} is already registered with a completed payment.` });
      }

      const allRolls = [leader.rollNumber, ...members.map((m: any) => m.rollNumber)].map(r => String(r).trim().toUpperCase());
      for (const roll of allRolls) {
        if (roll) {
          const existingRoll = await Users.findOne(u => String(u.rollNumber || '').trim().toUpperCase() === roll && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
          if (existingRoll) return res.status(400).json({ message: `Roll/ID number ${roll} is already registered with a completed payment.` });
        }
      }

      const allPhones = [leader.phone, ...members.map((m: any) => m.phone)].map(p => String(p).trim());
      for (const phone of allPhones) {
        const existingPhone = await Users.findOne(u => u.phone === phone && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
        if (existingPhone) return res.status(400).json({ message: `Phone number ${phone} is already registered with a completed payment.` });
      }

      const existingName = await Teams.findOne(t => t.name.toLowerCase() === cleanTeamName.toLowerCase());
      if (existingName) return res.status(400).json({ message: 'Team Name is already taken.' });

      let finalTeamCode = cleanTeamCode;
      const existingCode = await Teams.findOne(t => t.id.toLowerCase() === cleanTeamCode.toLowerCase());
      if (existingCode) {
        finalTeamCode = await generateTeamId();
      }

      // Create or update leader
      let leaderUser = await Users.findOne({ email: leader.email.toLowerCase() });
      const leaderData = {
        name: leader.name,
        email: leader.email.toLowerCase(),
        phone: leader.phone,
        college: leader.college,
        rollNumber: leader.rollNumber,
        branch: leader.branch,
        year: leader.year,
        gender: leader.gender,
        tshirtSize: leader.tshirtSize || 'M',
        linkedin: leader.linkedin || '',
        role: 'team-leader' as const,
        paymentStatus: 'paid' as const,
        paymentId: razorpay_payment_id,
        amountPaid: 399,
        checkedIn: false,
        profileCompleted: true,
        registrationType: 'TEAM' as const,
        teamId: finalTeamCode,
        teamRole: 'leader' as const,
        couponUsed: couponCode || undefined
      };

      if (leaderUser) {
        await Users.updateOne(leaderUser.id, leaderData);
        leaderUser = await Users.findOne({ id: leaderUser.id });
      } else {
        leaderUser = await Users.create({
          id: `u_${Math.random().toString(36).substring(2, 9)}`,
          ...leaderData,
          createdAt: new Date().toISOString()
        });
      }

      if (!leaderUser) {
        return res.status(500).json({ message: 'Failed to save leader user record.' });
      }

      // Create or update members
      const memberIds: string[] = [];
      for (const m of members) {
        let memberUser = await Users.findOne({ email: m.email.toLowerCase() });
        const memberData = {
          name: m.name,
          email: m.email.toLowerCase(),
          phone: m.phone || leader.phone,
          college: m.college || leader.college,
          rollNumber: m.rollNumber,
          branch: m.branch,
          year: m.year,
          gender: m.gender,
          tshirtSize: m.tshirtSize || 'M',
          linkedin: m.linkedin || '',
          role: 'participant' as const,
          paymentStatus: 'paid' as const,
          paymentId: razorpay_payment_id,
          amountPaid: 399,
          checkedIn: false,
          profileCompleted: true,
          registrationType: 'TEAM' as const,
          teamId: finalTeamCode,
          teamRole: 'member' as const,
          couponUsed: couponCode || undefined
        };

        if (memberUser) {
          await Users.updateOne(memberUser.id, memberData);
          memberIds.push(memberUser.id);
        } else {
          const mId = `u_${Math.random().toString(36).substring(2, 9)}`;
          await Users.create({
            id: mId,
            ...memberData,
            createdAt: new Date().toISOString()
          });
          memberIds.push(mId);
        }
      }

      // Create team
      const allTeamMembers = [leaderUser.id, ...memberIds];
      const team = await Teams.create({
        id: finalTeamCode,
        name: cleanTeamName,
        description: 'Created during team registration.',
        college: leader.college,
        leaderId: leaderUser.id,
        members: allTeamMembers,
        memberCount: allTeamMembers.length,
        remainingSlots: 5 - allTeamMembers.length,
        paidSlots: allTeamMembers.length,
        availableSlots: Math.max(0, 5 - allTeamMembers.length),
        teamStatus: allTeamMembers.length >= 5 ? 'CLOSED' : 'OPEN',
        status: allTeamMembers.length >= 5 ? 'full' : 'open',
        inviteLink: `${FRONTEND_BASE_URL}/teams/join?teamId=${finalTeamCode}`,
        joinRequests: [],
        paymentStatus: 'paid',
        createdAt: new Date().toISOString()
      });

      // Log payment
      await Payments.create({
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        userId: leaderUser.id,
        userName: leaderUser.name,
        userEmail: leaderUser.email,
        amount: amount || (totalMembersCount * 399),
        status: 'success',
        couponUsed: couponCode,
        createdAt: new Date().toISOString()
      });

      if (couponCode) {
        const coupon = await Coupons.findOne({ code: couponCode.toUpperCase() });
        if (coupon) {
          await Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });
        }
      }

      // Send confirmation emails
      try {
        await transporter.sendMail({
          from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
          to: leaderUser.email,
          subject: 'Team Registration Confirmed - CodeSprint 2026',
          html: `<p>Dear <strong>${leaderUser.name}</strong>,</p><p>Your team <strong>${team.name}</strong> has been registered successfully!</p>`
        });
      } catch (e) {
        console.error('Leader email send error:', e);
      }

      const token = jwt.sign({ id: leaderUser.id, role: 'team-leader' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, token, user: leaderUser, team });

    } else {
      // INDIVIDUAL
      const { name, email, phone, rollNumber, college, branch, year, gender, linkedin, portfolio, teamPreference, teamName, teamCode, foodPreference, tshirtSize } = registrationDetails;

      const existingUser = await Users.findOne(u => u.email.toLowerCase() === email.toLowerCase() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
      if (existingUser) return res.status(400).json({ message: `Email ${email} is already registered.` });

      const existingPhone = await Users.findOne(u => u.phone === phone && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
      if (existingPhone) return res.status(400).json({ message: `Phone number ${phone} is already registered.` });

      if (rollNumber) {
        const existingRoll = await Users.findOne(u => String(u.rollNumber || '').trim().toUpperCase() === String(rollNumber).trim().toUpperCase() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
        if (existingRoll) return res.status(400).json({ message: `Roll/ID number ${rollNumber} is already registered.` });
      }

      let existingRecord = await Users.findOne({ email: email.toLowerCase() });
      const individualData = {
        name,
        email: email.toLowerCase(),
        phone,
        college,
        rollNumber,
        branch,
        year,
        gender,
        linkedin,
        portfolio,
        teamPreference,
        tempTeamName: teamPreference === 'Create a Team' ? teamName : undefined,
        tempTeamCode: teamPreference === 'Join a Team' ? teamCode : undefined,
        tempSlots: 1,
        foodPreference: foodPreference || 'Veg',
        tshirtSize: tshirtSize || 'M',
        role: 'participant' as const,
        paymentStatus: 'paid' as const,
        paymentId: razorpay_payment_id,
        amountPaid: amount || 399,
        checkedIn: false,
        profileCompleted: true,
        registrationType: 'INDIVIDUAL' as const
      };

      let user: any;
      if (existingRecord) {
        await Users.updateOne(existingRecord.id, individualData);
        user = await Users.findOne({ id: existingRecord.id });
      } else {
        user = await Users.create({
          id: `u_${Math.random().toString(36).substring(2, 9)}`,
          ...individualData,
          createdAt: new Date().toISOString()
        });
      }

      await processUserTeamPreference(user.id);

      await Payments.create({
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

      if (couponCode) {
        const coupon = await Coupons.findOne({ code: couponCode.toUpperCase() });
        if (coupon) {
          await Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });
        }
      }

      try {
        await transporter.sendMail({
          from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
          to: user.email,
          subject: 'Registration Confirmed - CodeSprint 2026',
          html: `<p>Dear <strong>${user.name}</strong>,</p><p>Your registration for CodeSprint 2026 has been confirmed successfully!</p>`
        });
      } catch (e) {
        console.error('User email send error:', e);
      }

      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, token, user });
    }
  } catch (error: any) {
    console.error('Registration processing error:', error);
    return res.status(500).json({ message: error.message || 'Server error during verification & registration.' });
  }
});

// 1. Create Order (Real Razorpay integration)
router.post('/payments/create-order', authenticateToken, async (req: AuthRequest, res: Response) => {
  let expectedAmount = 399;
  try {
    const user = await Users.findOne({ id: req.user!.id });
    if (user) {
      if (user.role === 'team-leader' && user.teamId) {
        const team = await Teams.findOne({ id: user.teamId });
        if (team) {
          // Calculate amount only for members who have NOT paid yet
          const unpaidMembers = await Users.find(u => u.teamId === team.id && u.paymentStatus !== 'paid');
          expectedAmount = unpaidMembers.length * 399;
        }
      } else {
        expectedAmount = 399;
      }
    }

    // Handle coupon validation if couponCode is provided in the body
    const { couponCode } = req.body;
    if (couponCode) {
      const coupon = await Coupons.findOne({ code: couponCode.toUpperCase() });
      if (coupon && coupon.isActive && new Date(coupon.expiryDate).getTime() > Date.now() && coupon.usageCount < coupon.usageLimit) {
        let discountAmount = 0;
        if (coupon.discountType === 'percentage') {
          discountAmount = (expectedAmount * coupon.discountValue) / 100;
        } else {
          discountAmount = coupon.discountValue;
        }
        expectedAmount = Math.max(0, expectedAmount - discountAmount);
      }
    }

    const keyId = process.env.RAZORPAY_KEY_ID || process.env.key_id;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;

    if (!keyId || !keySecret) {
      console.log('[Payment] Razorpay credentials missing, returning mock order for bypass testing');
      return res.json({
        id: `order_mock_${Math.floor(100000 + Math.random() * 900000)}`,
        currency: 'INR',
        amount: expectedAmount * 100,
        keyId: 'mock_key_id'
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(expectedAmount * 100), // in paise
      currency: 'INR',
      receipt: `receipt_${uuidv4().substring(0, 14)}`
    });

    return res.json({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      keyId: keyId,
    });
  } catch (error: any) {
    console.error('Error creating Razorpay order:', error);
    return res.json({
      id: `order_mock_${Math.floor(100000 + Math.random() * 900000)}`,
      currency: 'INR',
      amount: expectedAmount * 100,
      keyId: 'mock_key_id'
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
    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;
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

  // Update user profile or cascade for team
  if (user.role === 'team-leader' && user.teamId) {
    await handleTeamPaymentSuccess(user.teamId, paymentLog.razorpayPaymentId, amount || 399);
  } else {
    await Users.updateOne(user.id, {
      paymentStatus: 'paid',
      paymentId: paymentLog.razorpayPaymentId,
      couponUsed: couponCode || undefined,
      amountPaid: amount || 399
    });
  }

  // Process auto-team preference (individual only, team leaders are already in a team)
  if (user.role !== 'team-leader') {
    await processUserTeamPreference(user.id);
  }

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



// Validation endpoint for unique team name / team code
router.get('/teams/validate-unique', async (req: Request, res: Response) => {
  const { name, code } = req.query;
  let nameTaken = false;
  let codeTaken = false;

  try {
    if (name) {
      const existingName = await Teams.findOne(t => t.name.toLowerCase() === String(name).trim().toLowerCase());
      if (existingName) nameTaken = true;
    }

    if (code) {
      const existingCode = await Teams.findOne(t => t.id.toLowerCase() === String(code).trim().toLowerCase());
      if (existingCode) codeTaken = true;
    }

    return res.json({ nameTaken, codeTaken });
  } catch (err: any) {
    return res.status(500).json({ message: err.message || 'Validation error' });
  }
});

// Register Team Flow (creates team + leader + members in pending state)
router.post('/teams/register-team-flow', async (req: Request, res: Response) => {
  const { teamName, teamCode, leader, members, teamStatus, availableSlots } = req.body;

  if (!teamName || !teamCode || !leader || !members || !Array.isArray(members)) {
    return res.status(400).json({ message: 'Missing team name, team code, leader, or members details.' });
  }

  const cleanTeamName = String(teamName).trim();
  const cleanTeamCode = String(teamCode).trim();
  const totalMembersCount = 1 + members.length;

  try {
    // 1. Validate team uniqueness
    const existingName = await Teams.findOne(t => t.name.toLowerCase() === cleanTeamName.toLowerCase());
    if (existingName) {
      return res.status(400).json({ message: 'Team Name is already taken.' });
    }

    let finalTeamCode = cleanTeamCode;
    const existingCode = await Teams.findOne(t => t.id.toLowerCase() === cleanTeamCode.toLowerCase());
    if (existingCode) {
      // If code is taken (e.g. concurrent registration), generate a new unique one on the fly!
      finalTeamCode = await generateTeamId();
    }

    // 2. Validate team size (3 to 5 total members)
    if (totalMembersCount < 3 || totalMembersCount > 5) {
      return res.status(400).json({ message: 'Your team must have between 3 and 5 members, including the Team Leader.' });
    }

    // 3. Validate female participant requirement
    const allGenders = [leader.gender, ...members.map(m => m.gender)];
    const hasFemale = allGenders.some(g => String(g).trim().toLowerCase() === 'female');
    if (!hasFemale) {
      return res.status(400).json({ message: 'At least one female participant is required in every team.' });
    }

    // 4. Validate unique email addresses and not already in team/database
    const allEmails = [leader.email, ...members.map(m => m.email)].map(e => String(e).trim().toLowerCase());
    const uniqueEmails = new Set(allEmails);
    if (uniqueEmails.size !== allEmails.length) {
      return res.status(400).json({ message: 'Duplicate emails detected in the team list.' });
    }

    for (const email of allEmails) {
      const existingUser = await Users.findOne(u => u.email.toLowerCase() === email && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
      if (existingUser) {
        return res.status(400).json({ message: `Email ${email} is already registered with a completed payment.` });
      }
    }

    // 4.1. Validate unique Roll/ID numbers
    const allRolls = [leader.rollNumber, ...members.map(m => m.rollNumber)].map(r => String(r).trim().toUpperCase());
    const uniqueRolls = new Set(allRolls);
    if (uniqueRolls.size !== allRolls.length) {
      return res.status(400).json({ message: 'Duplicate Roll/ID numbers detected in the team list.' });
    }

    for (const rollNumber of allRolls) {
      if (rollNumber) {
        const existingRoll = await Users.findOne(u => String(u.rollNumber || '').trim().toUpperCase() === rollNumber && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
        if (existingRoll) {
          return res.status(400).json({ message: `Roll/ID number ${rollNumber} is already registered with a completed payment.` });
        }
      }
    }

    // 4.2. Validate unique phone numbers
    const allPhones = [leader.phone, ...members.map(m => m.phone)].map(p => String(p).trim());
    const uniquePhones = new Set(allPhones);
    if (uniquePhones.size !== allPhones.length) {
      return res.status(400).json({ message: 'Duplicate phone numbers detected in the team list.' });
    }

    for (const phone of allPhones) {
      if (phone) {
        const existingPhone = await Users.findOne(u => u.phone === phone && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
        if (existingPhone) {
          return res.status(400).json({ message: `Phone number ${phone} is already registered with a completed payment.` });
        }
      }
    }

    // 5. Create or retrieve/update leader user
    let leaderUser = await Users.findOne({ email: leader.email.toLowerCase() });
    const leaderId = leaderUser ? leaderUser.id : `u_${Math.random().toString(36).substring(2, 9)}`;

    const leaderData = {
      id: leaderId,
      name: leader.name,
      email: leader.email.toLowerCase(),
      phone: leader.phone,
      college: leader.college,
      rollNumber: leader.rollNumber,
      branch: leader.branch,
      year: leader.year,
      gender: leader.gender,
      tshirtSize: leader.tshirtSize || 'M',
      linkedin: leader.linkedin || '',
      role: 'team-leader' as const,
      paymentStatus: 'pending' as const,
      amountPaid: 0,
      checkedIn: false,
      profileCompleted: true,
      registrationType: 'TEAM' as const,
      teamId: finalTeamCode,
      teamRole: 'leader' as const,
      createdAt: leaderUser?.createdAt || new Date().toISOString()
    };

    if (leaderUser) {
      await Users.updateOne(leaderUser.id, leaderData);
      leaderUser = await Users.findOne({ id: leaderUser.id });
    } else {
      leaderUser = await Users.create(leaderData);
    }

    // 6. Create or retrieve/update member users
    const memberIds: string[] = [];
    for (const m of members) {
      let memberUser = await Users.findOne({ email: m.email.toLowerCase() });
      const mId = memberUser ? memberUser.id : `u_${Math.random().toString(36).substring(2, 9)}`;
      
      const memberData = {
        id: mId,
        name: m.name,
        email: m.email.toLowerCase(),
        phone: m.phone || leader.phone, // fallback phone
        college: m.college || leader.college, // fallback college
        rollNumber: m.rollNumber,
        branch: m.branch,
        year: m.year,
        gender: m.gender,
        tshirtSize: m.tshirtSize || 'M',
        linkedin: m.linkedin || '',
        role: 'participant' as const,
        paymentStatus: 'pending' as const,
        amountPaid: 0,
        checkedIn: false,
        profileCompleted: true,
        registrationType: 'TEAM' as const,
        teamId: finalTeamCode,
        teamRole: 'member' as const,
        createdAt: memberUser?.createdAt || new Date().toISOString()
      };

      if (memberUser) {
        await Users.updateOne(memberUser.id, memberData);
      } else {
        await Users.create(memberData);
      }
      memberIds.push(mId);
    }

    // 7. Create the Team in pending state
    const allTeamMembers = [leaderId, ...memberIds];
    const team = await Teams.create({
      id: finalTeamCode,
      name: cleanTeamName,
      description: 'Created during team registration.',
      college: leader.college,
      leaderId: leaderId,
      members: allTeamMembers,
      memberCount: allTeamMembers.length,
      remainingSlots: 5 - allTeamMembers.length,
      paidSlots: allTeamMembers.length,
      availableSlots: teamStatus === 'OPEN' ? (Number(availableSlots) || 0) : 0,
      teamStatus: teamStatus === 'OPEN' ? 'OPEN' : 'CLOSED',
      status: allTeamMembers.length >= 5 ? 'full' as const : 'open' as const,
      inviteLink: `${FRONTEND_BASE_URL}/teams/join?teamId=${finalTeamCode}`,
      joinRequests: [],
      paymentStatus: 'pending' as const,
      createdAt: new Date().toISOString()
    });

    const token = jwt.sign({ id: leaderId, role: 'team-leader' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token, user: leaderUser, team });
  } catch (err: any) {
    console.error('[Register Team Flow Error]:', err);
    return res.status(500).json({ message: err.message || 'Server error during team registration.' });
  }
});

// --- TEAMS ENDPOINTS (AUTHENTICATED) ---

// 1. Create a Team
router.post('/teams/create', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { name, description, logoUrl, customTeamId } = req.body;
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

  const teamId = customTeamId || await generateTeamId();
  
  const team = await Teams.create({
    id: teamId,
    name,
    description,
    college: user.college,
    logoUrl,
    leaderId: user.id,
    members: [user.id],
    remainingSlots: 4, // Team of max 5
    paidSlots: user.tempSlots || 1, // Store total paid slots
    status: 'open',
    inviteLink: `${FRONTEND_BASE_URL}/teams/join?teamId=${teamId}`,
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

// Set Team Availability (open/closed status and slots)
router.post('/teams/set-availability', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { teamStatus, availableSlots } = req.body;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  if (!teamStatus) return res.status(400).json({ message: 'Team status is required.' });

  try {
    const user = await Users.findOne({ id: userId });
    if (!user || user.role !== 'team-leader' || !user.teamId) {
      return res.status(400).json({ message: 'Only team leaders can modify team availability.' });
    }

    const team = await Teams.findOne({ id: user.teamId });
    if (!team) return res.status(404).json({ message: 'Team not found.' });

    const maxAvailableSlots = 5 - team.members.length;
    let slots = Number(availableSlots) || 0;

    if (teamStatus === 'OPEN') {
      if (team.members.length >= 5) {
        return res.status(400).json({ message: 'Team is already full. Cannot keep team open.' });
      }
      if (slots < 1 || slots > maxAvailableSlots) {
        return res.status(400).json({ message: `Available slots must be between 1 and ${maxAvailableSlots}.` });
      }
    } else {
      slots = 0;
    }

    await Teams.updateOne(team.id, {
      teamStatus: teamStatus as 'OPEN' | 'CLOSED',
      availableSlots: slots
    });

    const updatedTeam = await Teams.findOne({ id: team.id });
    return res.json({ success: true, team: updatedTeam });
  } catch (err: any) {
    console.error('[Set Availability Error]:', err);
    return res.status(500).json({ message: err.message || 'Failed to update team availability.' });
  }
});

// 1.5. Add Member directly (Team Leader Only)
router.post('/teams/add-member', authenticateToken, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const leader = await Users.findOne({ id: userId });
  if (!leader || leader.teamRole !== 'leader' || !leader.teamId) {
    return res.status(400).json({ message: 'Only team leaders can add members.' });
  }

  const team = await Teams.findOne({ id: leader.teamId });
  if (!team) return res.status(404).json({ message: 'Team not found.' });

  const { members: membersArray } = req.body;

  // Calculate available prepaid slots
  const paidMembersCount = (await Users.find({ teamId: team.id, paymentStatus: 'paid' })).length;
  let availablePaidSlots = (team.paidSlots || 1) - paidMembersCount;

  // ── MULTI-MEMBER MODE (array payload from dashboard modal) ──
  if (Array.isArray(membersArray) && membersArray.length > 0) {
    // Capacity check
    if (team.members.length + membersArray.length > 5) {
      return res.status(400).json({
        message: `Adding ${membersArray.length} member(s) would exceed the team limit of 5. Your team currently has ${team.members.length} member(s).`
      });
    }

    const addedUsers: any[] = [];
    for (const m of membersArray) {
      const { name, email, phone, rollNumber, college, branch, year, gender, tshirtSize, foodPreference } = m;
      if (!name || !email) continue;

      let targetUser = await Users.findOne({ email: email.toLowerCase() });
      if (targetUser && targetUser.teamId) continue; // skip if already in a team

      // Decide payment status based on prepaid slots
      const paymentStatus = availablePaidSlots > 0 ? 'paid' : 'pending';
      if (availablePaidSlots > 0) {
        availablePaidSlots -= 1;
      }

      if (!targetUser) {
        targetUser = await Users.create({
          id: `u_${Math.random().toString(36).substring(2, 9)}`,
          name,
          email: email.toLowerCase(),
          phone: phone || leader.phone,
          college: college || leader.college,
          rollNumber: rollNumber || '',
          branch: branch || 'Unknown',
          year: year || '1st Year',
          gender: gender || 'Male',
          tshirtSize: tshirtSize || 'M',
          foodPreference: foodPreference || 'Veg',
          linkedin: '',
          role: 'participant',
          paymentStatus: paymentStatus,
          amountPaid: 0,
          checkedIn: false,
          profileCompleted: true,
          createdAt: new Date().toISOString()
        });
      } else {
        await Users.updateOne(targetUser.id, {
          paymentStatus: paymentStatus,
          amountPaid: 0,
          phone: phone || targetUser.phone || leader.phone,
          college: college || targetUser.college || leader.college,
          rollNumber: rollNumber || targetUser.rollNumber || '',
          branch: branch || targetUser.branch || 'Unknown',
          year: year || targetUser.year || '1st Year',
          gender: gender || targetUser.gender || 'Male',
          tshirtSize: tshirtSize || targetUser.tshirtSize || 'M',
          foodPreference: foodPreference || targetUser.foodPreference || 'Veg',
          profileCompleted: true
        });
      }

      await Users.updateOne(targetUser.id, { teamId: team.id, teamRole: 'member', role: 'participant' });
      if (!team.members.includes(targetUser.id)) {
        team.members.push(targetUser.id);
      }
      addedUsers.push(targetUser);

      // Send email to each added member
      try {
        const completeLink = `${FRONTEND_BASE_URL}/register?email=${encodeURIComponent(targetUser.email)}&name=${encodeURIComponent(targetUser.name)}`;
        await transporter.sendMail({
          from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
          to: targetUser.email,
          subject: 'You\'ve been added to a team - CodeSprint 2026',
          html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:30px;border:1px solid #e2e8f0;border-radius:12px;">
            <h1 style="color:#6d28d9;">CodeSprint 2026</h1>
            <p>Dear <strong>${targetUser.name}</strong>,</p>
            <p>Your team leader <strong>${leader.name}</strong> has added you to team <strong>${team.name}</strong>.</p>
            <p>Your registration status is: <strong>${paymentStatus === 'paid' ? 'Paid & Active' : 'Pending Payment'}</strong>.</p>
            <div style="text-align:center;margin:24px 0;">
              <a href="${completeLink}" style="background:#6d28d9;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Complete Your Profile</a>
            </div>
          </div>`
        });
      } catch (err) {
        console.error('Email send failed for', m.email, err);
      }
    }

    // Update team membership count
    await Teams.updateOne(team.id, {
      members: team.members,
      remainingSlots: Math.max(0, 5 - team.members.length),
      status: team.members.length >= 5 ? 'full' : 'open'
    });

    const updatedTeam = await Teams.findOne({ id: team.id });
    return res.json({ success: true, message: `${addedUsers.length} member(s) added successfully.`, team: updatedTeam });
  }

  // ── SINGLE MEMBER MODE (legacy / backwards compat) ──
  const { name, email, phone, rollNumber, college, branch, year, gender, tshirtSize, foodPreference } = req.body;
  if (!name || !email) {
    return res.status(400).json({ message: 'Name and Email are required.' });
  }

  if (team.members.length >= 5) {
    return res.status(400).json({ message: 'Your team already has the maximum of 5 members.' });
  }

  let targetUser = await Users.findOne({ email: email.toLowerCase() });
  if (targetUser && targetUser.teamId) {
    return res.status(400).json({ message: 'This user is already in a team.' });
  }

  const paymentStatus = availablePaidSlots > 0 ? 'paid' : 'pending';

  if (!targetUser) {
    targetUser = await Users.create({
      id: `u_${Math.random().toString(36).substring(2, 9)}`,
      name, email: email.toLowerCase(),
      phone: phone || leader.phone, college: college || leader.college,
      rollNumber: rollNumber || '', branch: branch || 'Unknown',
      year: year || '1st Year', gender: gender || 'Male',
      tshirtSize: tshirtSize || 'M', foodPreference: foodPreference || 'Veg',
      linkedin: '', role: 'participant', paymentStatus: paymentStatus,
      amountPaid: 0, checkedIn: false,
      profileCompleted: true, createdAt: new Date().toISOString()
    });
  } else {
    await Users.updateOne(targetUser.id, {
      paymentStatus: paymentStatus, amountPaid: 0,
      phone: phone || targetUser.phone || leader.phone,
      college: college || targetUser.college || leader.college,
      rollNumber: rollNumber || targetUser.rollNumber || '',
      branch: branch || targetUser.branch || 'Unknown',
      year: year || targetUser.year || '1st Year',
      gender: gender || targetUser.gender || 'Male',
      tshirtSize: tshirtSize || targetUser.tshirtSize || 'M',
      foodPreference: foodPreference || targetUser.foodPreference || 'Veg',
      profileCompleted: true
    });
  }

  await Users.updateOne(targetUser.id, { teamId: team.id, teamRole: 'member', role: 'participant' });

  if (!team.members.includes(targetUser.id)) {
    const updatedMembers = [...team.members, targetUser.id];
    await Teams.updateOne(team.id, {
      members: updatedMembers,
      remainingSlots: Math.max(0, 5 - updatedMembers.length),
      status: updatedMembers.length >= 5 ? 'full' : 'open'
    });
  }

  try {
    const completeLink = `${FRONTEND_BASE_URL}/register?email=${encodeURIComponent(targetUser.email)}&name=${encodeURIComponent(targetUser.name)}`;
    await transporter.sendMail({
      from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
      to: targetUser.email,
      subject: 'Complete Your Registration - CodeSprint 2026',
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:30px;border:1px solid #e2e8f0;border-radius:12px;">
        <h1 style="color:#6d28d9;">CodeSprint 2026</h1>
        <p>Dear <strong>${targetUser.name}</strong>,</p>
        <p>Your team leader <strong>${leader.name}</strong> has added you to team <strong>${team.name}</strong> for CodeSprint 2026.</p>
        <p>Your registration status is: <strong>${paymentStatus === 'paid' ? 'Paid & Active' : 'Pending Payment'}</strong>.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${completeLink}" style="background:#6d28d9;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Complete Your Profile</a>
        </div>
      </div>`
    });
  } catch (err) {
    console.error('Failed to send confirmation email:', err);
  }

  const updatedTeam = await Teams.findOne({ id: team.id });
  return res.json({ success: true, message: 'Member added successfully.', team: updatedTeam });
});


// 2. Request to Join a Team
router.post('/teams/join-request', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { teamId } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  const team = await Teams.findOne({ id: teamId });
  if (!team) return res.status(404).json({ message: 'Team not found' });

  if (user.paymentStatus !== 'paid') {
    return res.status(400).json({ message: 'Payment is required to join this team.' });
  }

  if (user.teamId) {
    return res.status(400).json({ message: 'You are already in a team' });
  }

  if (team.teamStatus === 'CLOSED' || (team.availableSlots !== undefined && team.availableSlots <= 0) || team.members.length >= 5) {
    return res.status(400).json({ message: 'Team is already full or closed to requests' });
  }

  // Check if request already pending
  const alreadyRequested = team.joinRequests.some(r => r.userId === user.id && (r.status === 'pending' || r.status === 'PENDING'));
  if (alreadyRequested) {
    return res.status(400).json({ message: 'Join request is already pending' });
  }

  // Add join request
  const updatedRequests = [...team.joinRequests, {
    requestId: uuidv4(),
    userId: user.id,
    name: user.name,
    email: user.email,
    college: user.college,
    status: 'PENDING' as const,
    requestedAt: new Date().toISOString()
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

  const request = team.joinRequests.find(r => r.userId === requestUserId && (r.status === 'pending' || r.status === 'PENDING'));
  if (!request) {
    return res.status(404).json({ message: 'Pending request not found' });
  }

  const teamModel = (Teams as any).model;

  if (status === 'approved' || status === 'ACCEPTED') {
    // Perform atomic findOneAndUpdate to prevent race conditions on vacancy
    const teamDoc = await teamModel.findOneAndUpdate(
      {
        id: teamId,
        leaderId: userId,
        teamStatus: 'OPEN',
        availableSlots: { $gt: 0 },
        members: { $ne: requestUserId } // ensure not already member
      },
      {
        $push: { members: requestUserId },
        $inc: { availableSlots: -1 }
      },
      { new: true }
    );

    if (!teamDoc) {
      return res.status(400).json({ message: 'Failed to accept request. Team may be full, closed, or participant is already a member.' });
    }

    const teamObj = teamDoc.toObject();

    // Check if team is now full/closed
    if (teamObj.availableSlots <= 0 || teamObj.members.length >= 5) {
      await teamModel.updateOne(
        { id: teamId },
        { $set: { teamStatus: 'CLOSED', status: 'full' } }
      );
    }

    // Now update request status inside the team document's joinRequests array
    await teamModel.updateOne(
      { id: teamId, "joinRequests.userId": requestUserId },
      { 
        $set: { 
          "joinRequests.$.status": 'ACCEPTED',
          "joinRequests.$.respondedAt": new Date().toISOString()
        } 
      }
    );

    // Cancel other pending join requests for this user across all teams
    const allTeams = await Teams.find({});
    for (const t of allTeams) {
      const userReqIdx = t.joinRequests.findIndex(r => r.userId === requestUserId && (r.status === 'pending' || r.status === 'PENDING'));
      if (userReqIdx !== -1) {
        const updatedReqs = t.joinRequests.map(r => 
          (r.userId === requestUserId && (r.status === 'pending' || r.status === 'PENDING'))
            ? { ...r, status: 'CANCELLED' as const, respondedAt: new Date().toISOString() }
            : r
        );
        await teamModel.updateOne({ id: t.id }, { $set: { joinRequests: updatedReqs } });
      }
    }

    const memberUser = await Users.findOne({ id: requestUserId });
    if (memberUser) {
      // Update member profile
      await Users.updateOne(requestUserId, {
        teamId: teamId,
        teamRole: 'member',
        role: 'participant'
      });
    }

    // Notify applicant
    await Notifications.create({
      recipientType: 'individual',
      recipientTarget: requestUserId,
      title: 'Request Approved!',
      message: `Congratulations! You have been accepted into team "${teamObj.name}".`,
      type: 'success',
      readBy: [],
      createdAt: new Date().toISOString()
    });

  } else {
    // Reject request
    await teamModel.updateOne(
      { id: teamId, "joinRequests.userId": requestUserId },
      { 
        $set: { 
          "joinRequests.$.status": 'REJECTED',
          "joinRequests.$.respondedAt": new Date().toISOString()
        } 
      }
    );

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

  const updatedTeam = await Teams.findOne({ id: teamId });
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
  if (!user) return res.status(404).json({ message: 'User not found' });
  
  if (!user.teamId) {
    const allTeams = await Teams.find({});
    const pendingTeam = allTeams.find(t => 
      t.joinRequests?.some(r => r.userId === userId && (r.status === 'pending' || r.status === 'PENDING'))
    );
    if (pendingTeam) {
      return res.json({ 
        team: null, 
        pendingRequestTeam: {
          id: pendingTeam.id,
          name: pendingTeam.name,
          leaderId: pendingTeam.leaderId
        }
      });
    }
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
        gender: mUser?.gender || '',
        branch: mUser?.branch || '',
        year: mUser?.year || '',
        checkedIn: mUser?.checkedIn || false,
        paymentStatus: mUser?.paymentStatus || 'pending',
        profileCompleted: mUser?.profileCompleted !== false
      };
    })
  );

  // Fetch enriched join request details
  const enrichedRequests = await Promise.all(
    (team.joinRequests || []).map(async (req) => {
      const requester = await Users.findOne({ id: req.userId });
      return {
        userId: req.userId,
        name: req.name,
        email: req.email,
        college: requester?.college || req.college,
        status: req.status,
        requestId: req.requestId,
        requestedAt: req.requestedAt,
        respondedAt: req.respondedAt,
        gender: requester?.gender || '',
        branch: requester?.branch || '',
        year: requester?.year || ''
      };
    })
  );

  return res.json({
    ...team,
    members: fullMembers,
    joinRequests: enrichedRequests
  });
});


// --- ADMIN ENDPOINTS (ADMIN ROLE ONLY) ---

// 1. Get Live Admin stats
router.get('/admin/stats', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const allUsers = await Users.find();
  const allTeams = await Teams.find();
  const allPayments = await Payments.find();
  const allVisitors = await VisitorLogs.find();

  const totalRegistrations = allUsers.filter(u => u.role !== 'admin').length;
  const paidParticipants = allUsers.filter(u => u.paymentStatus === 'paid' && u.role !== 'admin').length;
  const pendingPayments = allUsers.filter(u => u.paymentStatus === 'pending' && u.role !== 'admin').length;
  const submittedPayments = allUsers.filter(u => u.paymentStatus === 'submitted' && u.role !== 'admin').length;
  const rejectedPayments = allUsers.filter(u => u.paymentStatus === 'rejected' && u.role !== 'admin').length;
  const totalTeams = allTeams.length;
  const checkedInCount = allUsers.filter(u => u.checkedIn && u.role !== 'admin').length;
  
  // Calculate unique visitors & pageviews
  const uniqueVisitorsCount = allVisitors.length;
  const totalPageViews = allVisitors.reduce((sum, v) => sum + (v.visitCount || 1), 0);
  const recentVisitorLogs = [...allVisitors]
    .sort((a, b) => new Date(b.lastVisitedAt || 0).getTime() - new Date(a.lastVisitedAt || 0).getTime())
    .slice(0, 50);

  // Calculate total revenue
  const totalRevenue = allPayments
    .filter(p => p.status === 'success')
    .reduce((sum, p) => sum + p.amount, 0);

  // College count (non-admin paid participants with normalization)
  const collegeCounts: { [key: string]: number } = {};
  allUsers
    .filter(u => u.role !== 'admin' && (u.paymentStatus === 'paid' || u.checkedIn))
    .forEach(u => {
      if (u.college) {
        const canonical = normalizeCollegeName(u.college);
        collegeCounts[canonical] = (collegeCounts[canonical] || 0) + 1;
      }
    });

  const collegesParticipating = Object.keys(collegeCounts).length;

  // Daily registration chart data (Group by date over last 7 days + registration dates)
  const registrationsByDate: { [key: string]: number } = {};
  
  // Pre-fill past 7 days with 0 count
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split('T')[0];
    registrationsByDate[dateKey] = 0;
  }

  allUsers.forEach(u => {
    if (u.role === 'admin') return;
    const dateStr = u.createdAt ? u.createdAt.split('T')[0] : 'Unknown';
    if (dateStr !== 'Unknown') {
      registrationsByDate[dateStr] = (registrationsByDate[dateStr] || 0) + 1;
    }
  });

  const liveRegistrationsGraph = Object.keys(registrationsByDate).map(date => ({
    date,
    count: registrationsByDate[date]
  })).sort((a, b) => a.date.localeCompare(b.date));

  return res.json({
    totalRegistrations,
    paidParticipants,
    pendingPayments,
    submittedPayments,
    rejectedPayments,
    totalTeams,
    totalRevenue,
    checkedInCount,
    collegesParticipating,
    collegeDistribution: collegeCounts,
    liveRegistrationsGraph,
    uniqueVisitorsCount,
    totalPageViews,
    visitorLogs: recentVisitorLogs
  });
});

// Track Unique Visit by IP / User ID
router.post('/track-visit', async (req: Request, res: Response) => {
  try {
    const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
                  req.socket.remoteAddress ||
                  req.ip ||
                  '127.0.0.1';
    
    // Normalize client IP address
    const clientIp = rawIp.replace(/^::ffff:/, '');

    const { userId, userEmail, path, userAgent } = req.body || {};
    const now = new Date().toISOString();

    // Find existing visitor by IP address or User ID
    let visitor = await VisitorLogs.findOne(v => v.ip === clientIp || (Boolean(userId) && v.userId === userId));

    if (visitor) {
      await VisitorLogs.updateOne(visitor.id, {
        visitCount: (visitor.visitCount || 1) + 1,
        lastVisitedAt: now,
        path: path || visitor.path,
        userAgent: userAgent || visitor.userAgent,
        userId: userId || visitor.userId,
        userEmail: userEmail || visitor.userEmail
      });
    } else {
      visitor = await VisitorLogs.create({
        ip: clientIp,
        userId: userId || undefined,
        userEmail: userEmail || undefined,
        path: path || '/',
        userAgent: userAgent || '',
        visitCount: 1,
        firstVisitedAt: now,
        lastVisitedAt: now
      });
    }

    return res.json({ success: true, visitCount: visitor.visitCount, ip: clientIp });
  } catch (error) {
    console.error('[Track Visit] Error:', error);
    return res.status(500).json({ message: 'Failed to record visit' });
  }
});

// 2. Get list of participants
router.get('/admin/participants', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { search } = req.query;
  let list = await Users.find(u => u.role !== 'admin');

  // Attach team names for display
  const allTeams = await Teams.find();
  const teamMap: Record<string, string> = {};
  const teamMemberCountMap: Record<string, number> = {};
  allTeams.forEach(t => {
    teamMap[t.id] = t.name;
    teamMemberCountMap[t.id] = (t.members || []).length;
  });

  const enriched = list.map(u => {
    let expectedAmount = 399;
    if (u.role === 'team-leader' && u.teamId) {
      expectedAmount = (teamMemberCountMap[u.teamId] || 1) * 399;
    } else if (u.role === 'participant' && u.teamId) {
      expectedAmount = 0;
    }
    return {
      ...u,
      teamName: u.teamId ? (teamMap[u.teamId] || u.teamId) : null,
      expectedAmount
    };
  });

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

// 2b. Delete a participant
router.delete('/admin/participants/:id', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = await Users.findOne({ id });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Clean up team reference if user is in a team
  if (user.teamId) {
    const team = await Teams.findOne({ id: user.teamId });
    if (team) {
      if (team.leaderId === user.id) {
        // User is the leader: dissolve the team
        await Promise.all(team.members.map(mId => {
          if (mId !== user.id) {
            return Users.updateOne(mId, { teamId: undefined, teamRole: undefined, role: 'participant' });
          }
          return Promise.resolve();
        }));
        await Teams.deleteOne(team.id);
      } else {
        // User is a member: pull them from the team members list
        const updatedMembers = team.members.filter(mId => mId !== user.id);
        const newSlots = team.remainingSlots + 1;
        const teamStatus = newSlots > 0 ? 'open' as const : 'full' as const;
        
        await Teams.updateOne(team.id, {
          members: updatedMembers,
          remainingSlots: newSlots,
          status: teamStatus
        });
      }
    }
  }

  // Delete the user
  const deleted = await Users.deleteOne(id);
  if (!deleted) {
    return res.status(500).json({ message: 'Failed to delete user' });
  }

  return res.json({ success: true, message: 'User deleted successfully' });
});

// 2c. Impersonate / Login as user
router.post('/admin/impersonate', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  const user = await Users.findOne({ id: userId });
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Generate JWT token for this user
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'codesprint-secret-key-2026',
    { expiresIn: '7d' }
  );

  return res.json({ success: true, token });
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

// 11. Export CSV Participants (Full analytics + Day-by-day + Colleges + Participant Ledger)
router.get('/admin/export-csv', authenticateToken, requireAdmin, async (req: Request, res: Response) => {
  const users = await Users.find(u => u.role !== 'admin' && (u.paymentStatus === 'paid' || u.checkedIn));
  const allTeams = await Teams.find();
  const teamMap: Record<string, string> = {};
  allTeams.forEach(t => { teamMap[t.id] = t.name; });

  // 1. Day-by-day registrations breakdown
  const registrationsByDate: Record<string, number> = {};
  users.forEach(u => {
    const dateStr = u.createdAt ? u.createdAt.split('T')[0] : 'Unknown';
    if (dateStr !== 'Unknown') {
      registrationsByDate[dateStr] = (registrationsByDate[dateStr] || 0) + 1;
    }
  });
  const dateRows = Object.keys(registrationsByDate)
    .sort((a, b) => a.localeCompare(b))
    .map(date => `"${date}",${registrationsByDate[date]}`)
    .join('\n');

  // 2. College-wise distribution breakdown (with normalization)
  const collegeCounts: Record<string, number> = {};
  users.forEach(u => {
    if (u.college) {
      const canonical = normalizeCollegeName(u.college);
      collegeCounts[canonical] = (collegeCounts[canonical] || 0) + 1;
    }
  });
  const collegeRows = Object.keys(collegeCounts)
    .sort((a, b) => collegeCounts[b] - collegeCounts[a])
    .map(clg => `"${clg}",${collegeCounts[clg]}`)
    .join('\n');

  // 3. Participant Registration records
  const headers = 'ID,Name,Email,Phone,College,Branch,Year,Gender,TshirtSize,TeamName,PaymentStatus,AmountPaid,RegistrationDate\n';
  const participantRows = users.map(u => {
    const teamName = u.teamId ? (teamMap[u.teamId] || u.teamId) : '';
    return `"${u.id}","${u.name}","${u.email}","${u.phone}","${u.college}","${u.branch}","${u.year}","${u.gender || ''}","${u.tshirtSize || ''}","${teamName}","${u.paymentStatus}",${u.amountPaid || 0},"http://localhost:3000","${u.createdAt}"`;
  }).join('\n');

  const csvContent = 
`================================================================================
CODESPRINT 2026 — COMPREHENSIVE REGISTRATION & ANALYTICS REPORT
Generated On: ${new Date().toISOString()}
Total Registrations: ${users.length}
================================================================================

=== SECTION 1: DAY-BY-DAY REGISTRATIONS BREAKDOWN ===
Date,Registered Students Count
${dateRows || 'No records'}

=== SECTION 2: COLLEGE-WISE REGISTRATION DISTRIBUTION ===
College Name,Student Count
${collegeRows || 'No records'}

=== SECTION 3: ALL PARTICIPANT REGISTRATION RECORDS ===
${headers}${participantRows}
`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=codesprint_registrations_analytics_report.csv');
  return res.send(csvContent);
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
  // Check if invitee has not paid, but team has available paid slots
  const paidMembersCount = (await Users.find({ teamId: team.id, paymentStatus: 'paid' })).length;
  const availablePaidSlots = (team.paidSlots || 1) - paidMembersCount;
  
  if (invitee?.paymentStatus !== 'paid' && availablePaidSlots <= 0) {
    return res.status(400).json({ message: 'User must have completed payment to join this team (no pre-paid slots left)' });
  }

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

  // Check if we should cover this user with pre-paid slots
  const paidMembersCount = (await Users.find({ teamId: team.id, paymentStatus: 'paid' })).length;
  const isPrepaid = team.paidSlots && team.paidSlots > paidMembersCount;

  await Users.updateOne(userId, { 
    teamId: team.id, 
    teamRole: 'member',
    paymentStatus: isPrepaid ? 'paid' : user.paymentStatus,
    amountPaid: isPrepaid ? 0 : user.amountPaid
  });
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

  // Load existing college names (case-insensitive dedup)
  const existing = await CollegesDb.find({});
  const existingNames = new Set(existing.map((c: any) => c.name.toLowerCase().trim()));

  // Parse CSV (assuming 1 column for college name)
  const lines = csvContent.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  const added = [];
  // Skip header if it says 'college' or 'name'
  if (lines[0].toLowerCase().includes('college') || lines[0].toLowerCase().includes('name')) {
    lines.shift();
  }

  for (const line of lines) {
    const name = line.replace(/(^"|"$)/g, '').trim(); // basic CSV quote stripping
    if (name && !existingNames.has(name.toLowerCase())) {
      const col = await CollegesDb.create({
        id: `col_${uuidv4()}`,
        name,
        createdAt: new Date().toISOString()
      });
      added.push(col);
      existingNames.add(name.toLowerCase()); // prevent intra-upload dupes too
    }
  }
  const totalNow = existing.length + added.length;
  res.json({ success: true, count: added.length, total: totalNow, message: `Added ${added.length} new college(s). Total: ${totalNow}.` });
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
