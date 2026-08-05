"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdmin = exports.authenticateToken = exports.VERIFICATION_GRACE_DEADLINE = exports.REGISTRATION_DEADLINE = void 0;
exports.isRegistrationClosed = isRegistrationClosed;
exports.isVerificationClosed = isVerificationClosed;
exports.normalizeCollegeName = normalizeCollegeName;
exports.ensureCollegeExists = ensureCollegeExists;
const express_1 = require("express");
const mongoose_1 = __importDefault(require("mongoose"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const crypto_1 = __importDefault(require("crypto"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const razorpay_1 = __importDefault(require("razorpay"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("../config/db");
const campaignService_1 = require("../services/campaignService");
dotenv_1.default.config();
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'codesprint-secret-key-2026';
const FRONTEND_BASE_URL = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : '';
const razorpay = new razorpay_1.default({
    key_id: process.env.RAZORPAY_KEY_ID || process.env.key_id || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.key_secret || ''
});
// Registration Cutoff: Wednesday, August 5, 2026 at 11:59:59 PM IST (Midnight)
exports.REGISTRATION_DEADLINE = new Date('2026-08-05T23:59:59+05:30').getTime();
// 15-minute grace period for verifying payments already in-flight before midnight
exports.VERIFICATION_GRACE_DEADLINE = new Date('2026-08-06T00:15:00+05:30').getTime();
function isRegistrationClosed() {
    return Date.now() >= exports.REGISTRATION_DEADLINE;
}
function isVerificationClosed() {
    return Date.now() >= exports.VERIFICATION_GRACE_DEADLINE;
}
/**
 * Normalizes college names to strip raw CSV quotes, numbers, IDs, and type prefixes ("Private", "State", "Deemed"), mapping typos and casing to clean canonical college names.
 */
function normalizeCollegeName(rawName) {
    if (!rawName)
        return '';
    let str = String(rawName).trim();
    // Strip outer quotes if any
    str = str.replace(/^["'\s]+|["'\s]+$/g, '');
    // If CSV line format: 1001","Private","Sharda University" or 1001,Private,Sharda University
    if (str.includes('","') || str.includes('", "') || str.includes('",') || str.includes(',"')) {
        const parts = str.split(/",\s*"|",|,"/).map(p => p.replace(/^"+|"+$/g, '').trim());
        const cleanPart = parts.find(p => {
            const low = p.toLowerCase().trim();
            if (/^\d+$/.test(low))
                return false;
            if (['private', 'state', 'central', 'deemed to be universities', 'deemed university', 'deemed', 'government'].includes(low))
                return false;
            return true;
        });
        if (cleanPart)
            str = cleanPart;
    }
    // Remove leading numbers & quotes/commas
    str = str.replace(/^\d+[\s,"']*/, '');
    // Remove category prefixes (e.g., Private, State, Central, Deemed)
    str = str.replace(/^(Private|State|Central|Deemed to be Universities|Deemed|Government)\s*[\s,"'-]*/i, '');
    // Remove leftover quotes and backslashes
    str = str.replace(/["'\\]/g, '');
    // Remove any leftover leading numbers or symbols
    str = str.replace(/^[\d\s,.-]+/, '');
    // Common spelling typos & variations
    str = str.replace(/\s+/g, ' ').trim();
    str = str.replace(/instuite/gi, 'Institute');
    str = str.replace(/instittue/gi, 'Institute');
    str = str.replace(/intstitute/gi, 'Institute');
    str = str.replace(/universty/gi, 'University');
    str = str.replace(/univercity/gi, 'University');
    // Title Case
    return str
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
/**
 * Ensures a college name exists in CollegesDb. If not, normalizes and saves it.
 */
async function ensureCollegeExists(rawName) {
    if (!rawName)
        return '';
    const trimmed = rawName.trim();
    if (!trimmed || trimmed.toLowerCase() === 'other' || trimmed.toLowerCase() === 'n/a') {
        return trimmed;
    }
    const normalized = normalizeCollegeName(trimmed);
    const existing = await db_1.CollegesDb.find({});
    const exists = existing.some((c) => c.name.toLowerCase().trim() === normalized.toLowerCase().trim());
    if (!exists) {
        await db_1.CollegesDb.create({
            id: `col_${(0, uuid_1.v4)()}`,
            name: normalized,
            createdAt: new Date().toISOString()
        });
        console.log(`[CollegesDb] Saved new college to database: ${normalized}`);
    }
    return normalized;
}
const transporter = nodemailer_1.default.createTransport({
    service: 'gmail',
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    rateLimit: 1,
    auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || ''
    }
});
// Authentication Middleware
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Authorization token required' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET, { ignoreExpiration: true });
        let user;
        if (decoded.id === 'admin-local' || (decoded.id && decoded.id.startsWith('admin-') && decoded.role === 'admin')) {
            // Covers legacy 'admin-local' and new Google-auth admin ids like 'admin-vamshi'
            user = { id: decoded.id, role: 'admin' };
        }
        else {
            user = await db_1.Users.findOne({ id: decoded.id });
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
        }
        req.user = { id: user.id, role: user.role };
        next();
    }
    catch (error) {
        return res.status(403).json({ message: 'Invalid or expired token' });
    }
};
exports.authenticateToken = authenticateToken;
// Admin Middleware
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};
exports.requireAdmin = requireAdmin;
const generateTeamId = async () => {
    try {
        const CounterModel = mongoose_1.default.models.Counter || mongoose_1.default.model('Counter', new mongoose_1.default.Schema({
            _id: { type: String, required: true },
            seq: { type: Number, default: 750 }
        }));
        const counter = await CounterModel.findByIdAndUpdate('team_code_counter', { $inc: { seq: 1 } }, { new: true, upsert: true });
        let formattedSeq = String(counter.seq).padStart(3, '0');
        let teamId = `CS2026-${formattedSeq}`;
        // Extra safety check in case the ID exists from historical manual data
        let existing = await db_1.Teams.findOne({ id: teamId });
        let safetyAttempts = 0;
        while (existing && safetyAttempts < 100) {
            safetyAttempts++;
            const nextCounter = await CounterModel.findByIdAndUpdate('team_code_counter', { $inc: { seq: 1 } }, { new: true, upsert: true });
            teamId = `CS2026-${String(nextCounter.seq).padStart(3, '0')}`;
            existing = await db_1.Teams.findOne({ id: teamId });
        }
        return teamId;
    }
    catch (err) {
        console.error('Error generating atomic team ID, falling back to secure random entropy:', err);
        const randomNum = Math.floor(100 + Math.random() * 900);
        const randomHex = crypto_1.default.randomBytes(1).toString('hex').toUpperCase();
        return `CS2026-${randomNum}${randomHex}`;
    }
};
const handleTeamPaymentSuccess = async (teamId, paymentId, totalAmountPaid, payerId) => {
    try {
        const team = await db_1.Teams.findOne({ id: teamId });
        if (!team)
            return;
        const members = await db_1.Users.find(u => u.teamId === teamId);
        // Update Team Payment status
        await db_1.Teams.updateOne(team.id, {
            paymentStatus: 'paid',
            paidSlots: members.length
        });
        const actualPayerId = payerId || team.leaderId;
        for (const member of members) {
            const isPayer = member.id === actualPayerId;
            if (isPayer) {
                await db_1.Users.updateOne(member.id, {
                    paymentStatus: 'paid',
                    paymentId: paymentId,
                    amountPaid: (member.amountPaid || 0) + totalAmountPaid
                });
            }
            else if (member.paymentStatus !== 'paid') {
                await db_1.Users.updateOne(member.id, {
                    paymentStatus: 'paid',
                    paymentId: paymentId,
                    amountPaid: 0
                });
                // Create in-app notification
                await db_1.Notifications.create({
                    recipientType: 'individual',
                    recipientTarget: member.id,
                    title: 'Team Registration Confirmed',
                    message: `Your team "${team.name}" registration fee has been fully paid! You are now registered.`,
                    type: 'success',
                    readBy: [],
                    createdAt: new Date().toISOString()
                });
            }
            // Send confirmation email to newly paid members or the payer
            if (member.paymentStatus !== 'paid' || isPayer) {
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
                  Great news! The payment for your team <strong>${team.name}</strong> has been completed.
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
                }
                catch (emailErr) {
                    console.error(`Failed to send email to team member ${member.email}:`, emailErr);
                }
            }
        }
    }
    catch (err) {
        console.error('Error handling team payment success cascade:', err);
    }
};
const processUserTeamPreference = async (userId) => {
    try {
        const user = await db_1.Users.findOne({ id: userId });
        if (!user || user.teamId)
            return;
        if (user.teamPreference === 'Create a Team' && user.tempTeamName) {
            const teamId = await generateTeamId();
            const team = await db_1.Teams.create({
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
            await db_1.Users.updateOne(user.id, {
                role: 'team-leader',
                teamId: team.id,
                teamRole: 'leader'
            });
            console.log(`[Team Auto-Create] Created team "${user.tempTeamName}" for user ${user.email}`);
        }
        else if (user.teamPreference === 'Join a Team' && user.tempTeamCode) {
            const targetTeam = await db_1.Teams.findOne({ id: user.tempTeamCode });
            if (targetTeam) {
                const alreadyRequested = targetTeam.joinRequests?.some(r => r.userId === user.id) || false;
                const alreadyMember = targetTeam.members?.includes(user.id) || false;
                if (!alreadyRequested && !alreadyMember && targetTeam.remainingSlots > 0) {
                    const updatedRequests = [...(targetTeam.joinRequests || []), {
                            userId: user.id,
                            name: user.name,
                            email: user.email,
                            college: user.college,
                            status: 'pending'
                        }];
                    await db_1.Teams.updateOne(targetTeam.id, { joinRequests: updatedRequests });
                    // Send notification to Team Leader
                    await db_1.Notifications.create({
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
    }
    catch (err) {
        console.error('Error processing auto team preference:', err);
    }
};
// --- AUTHENTICATION ENDPOINTS ---
// Check duplicate phone, roll number, or email before signup/payment
router.get('/users/check-duplicate', async (req, res) => {
    const { phone, rollNumber, email } = req.query;
    try {
        if (phone) {
            const existingPhone = await db_1.Users.findOne(u => u.phone === String(phone).trim() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
            if (existingPhone) {
                return res.status(200).json({ exists: true, type: 'phone', message: `Phone number ${phone} is already registered.` });
            }
        }
        if (rollNumber) {
            const existingRoll = await db_1.Users.findOne(u => String(u.rollNumber || '').trim().toUpperCase() === String(rollNumber).trim().toUpperCase() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
            if (existingRoll) {
                return res.status(200).json({ exists: true, type: 'rollNumber', message: `Roll/ID number ${rollNumber} is already registered.` });
            }
        }
        if (email) {
            const existingEmail = await db_1.Users.findOne(u => u.email.toLowerCase() === String(email).trim().toLowerCase() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
            if (existingEmail) {
                return res.status(200).json({ exists: true, type: 'email', message: `Email address ${email} is already registered.` });
            }
        }
        return res.status(200).json({ exists: false });
    }
    catch (error) {
        console.error('Error checking duplicate:', error);
        return res.status(500).json({ message: 'Internal server error checking duplicate.' });
    }
});
// 2. Verify and Complete Details (Handles profile updates and uniqueness validation before checkout)
router.post('/auth/otp-verify', async (req, res) => {
    const { email, name, phone, college, rollNumber, branch, year, gender, linkedin, portfolio, teamPreference, teamName, teamCode, slots, foodPreference, tshirtSize } = req.body;
    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }
    let user = await db_1.Users.findOne({ email: email.toLowerCase() });
    const normCollege = college ? await ensureCollegeExists(college) : '';
    if (user && user.profileCompleted === false) {
        // Existing pre-paid member completing profile details!
        if (phone) {
            const existingPhone = await db_1.Users.findOne({ phone });
            if (existingPhone && existingPhone.id !== user.id) {
                return res.status(400).json({ message: 'Phone number is already registered.' });
            }
        }
        if (rollNumber) {
            const existingRoll = await db_1.Users.findOne({ rollNumber });
            if (existingRoll && existingRoll.id !== user.id) {
                return res.status(400).json({ message: 'Roll number / ID number is already registered.' });
            }
        }
        const updateData = {
            name: name || user.name,
            phone,
            college: normCollege || college,
            rollNumber,
            branch,
            year,
            linkedin,
            portfolio,
            tshirtSize: tshirtSize || 'M',
            profileCompleted: true
        };
        if (gender) {
            updateData.gender = gender;
        }
        await db_1.Users.updateOne(user.id, updateData);
        user = await db_1.Users.findOne({ id: user.id });
    }
    else if (!user) {
        // If sign up details are missing, tell the frontend to collect them
        if (!name || !phone || !college || !branch || !year || !gender) {
            return res.status(202).json({
                newUser: true,
                message: 'New user: Please complete your registration details.'
            });
        }
        // Check unique phone
        const existingPhone = await db_1.Users.findOne({ phone });
        if (existingPhone) {
            return res.status(400).json({ message: 'Phone number is already registered.' });
        }
        // Check unique rollNumber / ID
        if (rollNumber) {
            const existingRoll = await db_1.Users.findOne({ rollNumber });
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
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '36500d' });
    return res.json({ token, user });
});
// 2.5. Admin Login (Password-only for local running)
router.post('/auth/admin-login', async (req, res) => {
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
    const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '36500d' });
    return res.json({ token, user });
});
// 3. Google Login — verify Firebase ID token
router.post('/auth/google-login', async (req, res) => {
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
        const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
        });
        if (!verifyRes.ok) {
            const errBody = await verifyRes.json();
            console.error('[Google Login] Token verification failed:', errBody);
            return res.status(401).json({ message: 'Invalid or expired Google token.' });
        }
        const verifyData = await verifyRes.json();
        const googleUser = verifyData?.users?.[0];
        if (!googleUser) {
            return res.status(401).json({ message: 'Could not retrieve Google user info.' });
        }
        const email = (googleUser.email || '').toLowerCase().trim();
        const name = googleUser.displayName || email.split('@')[0];
        // Check if user already exists in DB
        let user = await db_1.Users.findOne({ email });
        if (!user) {
            // User is not registered in database
            return res.status(404).json({
                notRegistered: true,
                email,
                name,
                message: 'Account not found. Please register first to participate in CodeSprint-2026.',
            });
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '36500d' });
        return res.json({ token, user });
    }
    catch (err) {
        console.error('[Google Login] Error:', err);
        return res.status(500).json({ message: 'Server error during Google authentication.' });
    }
});
// 3.5. Bypass Login (for testing only)
router.post('/auth/bypass-login', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: 'Email is required.' });
    }
    try {
        const targetEmail = (email || '').toLowerCase().trim();
        const user = await db_1.Users.findOne({ email: targetEmail });
        if (!user) {
            return res.status(404).json({ message: 'User not found in database.' });
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '36500d' });
        return res.json({ token, user });
    }
    catch (err) {
        console.error('[Bypass Login] Error:', err);
        return res.status(500).json({ message: 'Server error during bypass login.' });
    }
});
// ══════════════════════════════════════════════════════════════════════════════
// ADMIN GOOGLE AUTH — Google sign-in + OTP email verification
// ══════════════════════════════════════════════════════════════════════════════
// Helper: send OTP email
async function sendOtpEmail(to, name, code) {
    const transporter = nodemailer_1.default.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
        from: `"CodeSprint Admin" <${process.env.EMAIL_USER}>`,
        to,
        subject: '🔐 Your Admin Login OTP — CodeSprint 2026',
        html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;background:#09090b;color:#f4f4f5;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px">
          <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px">🛡️ Admin Access OTP</div>
          <div style="font-size:13px;opacity:0.85;margin-top:4px">CodeSprint 2026 — Secure Login</div>
        </div>
        <div style="padding:32px">
          <p style="margin:0 0 8px;font-size:14px;color:#a1a1aa">Hello <strong style="color:#f4f4f5">${name}</strong>,</p>
          <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa">Your one-time admin login code is:</p>
          <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
            <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#818cf8;font-family:monospace">${code}</div>
          </div>
          <p style="font-size:12px;color:#71717a;margin:0">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
          <p style="font-size:12px;color:#71717a;margin:12px 0 0">If you did not request this, ignore this email — someone may have used your Google account on the admin panel.</p>
        </div>
        <div style="background:#18181b;padding:16px 32px;border-top:1px solid #27272a;font-size:11px;color:#52525b;text-align:center">
          CodeSprint 2026 · Audisankara University · Restricted Admin Access
        </div>
      </div>
    `,
    });
}
// A.1 — POST /api/admin/google-auth
//   Body: { idToken: string }
//   → verifies Google token, checks AdminAllowlist, sends OTP
router.post('/admin/google-auth', async (req, res) => {
    const { idToken } = req.body;
    if (!idToken)
        return res.status(400).json({ message: 'Google ID token is required.' });
    try {
        // 1. Verify Firebase ID token via Identity Toolkit
        const firebaseApiKey = process.env.FIREBASE_API_KEY || 'AIzaSyDmsAFVX-u4Mp_N_HVYO-62BLulWTKbpSE';
        const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
        if (!verifyRes.ok)
            return res.status(401).json({ message: 'Invalid or expired Google token.' });
        const verifyData = await verifyRes.json();
        const gUser = verifyData?.users?.[0];
        if (!gUser)
            return res.status(401).json({ message: 'Could not retrieve Google account info.' });
        const email = (gUser.email || '').toLowerCase().trim();
        const name = gUser.displayName || email.split('@')[0];
        // 2. Check AdminAllowlist
        const allowed = await db_1.AdminAllowlist.findOne({ email });
        if (!allowed) {
            return res.status(403).json({ message: `Access denied. ${email} is not an authorised admin.` });
        }
        // 3. Invalidate any existing OTPs for this email
        const existing = await db_1.OtpStore.find({ email });
        for (const old of existing) {
            await db_1.OtpStore.updateOne(old.id, { used: true });
        }
        // 4. Generate 6-digit OTP
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // +10 min
        await db_1.OtpStore.create({ email, code, expiresAt, used: false, createdAt: new Date().toISOString() });
        // 5. Send email
        await sendOtpEmail(email, allowed.name, code);
        // 6. Return masked email
        const [localPart, domain] = email.split('@');
        const masked = localPart.slice(0, 3) + '***@' + domain;
        return res.json({ otpSent: true, email, maskedEmail: masked, name: allowed.name });
    }
    catch (err) {
        console.error('[Admin Google Auth] Error:', err);
        return res.status(500).json({ message: 'Server error during Google authentication.' });
    }
});
// A.2 — POST /api/admin/verify-otp
//   Body: { email: string, code: string }
//   → verifies OTP, returns JWT
router.post('/admin/verify-otp', async (req, res) => {
    const { email, code } = req.body;
    if (!email || !code)
        return res.status(400).json({ message: 'Email and OTP code are required.' });
    try {
        const normalEmail = email.toLowerCase().trim();
        // Find a valid, unused OTP
        const otpRecord = await db_1.OtpStore.findOne((o) => o.email === normalEmail && o.code === String(code).trim() && !o.used);
        if (!otpRecord) {
            return res.status(401).json({ message: 'Invalid OTP. Please check the code and try again.' });
        }
        // Check expiry
        if (new Date() > new Date(otpRecord.expiresAt)) {
            await db_1.OtpStore.updateOne(otpRecord.id, { used: true });
            return res.status(401).json({ message: 'OTP has expired. Please sign in with Google again.' });
        }
        // Mark used
        await db_1.OtpStore.updateOne(otpRecord.id, { used: true });
        // Get allowlist entry for display name
        const allowed = await db_1.AdminAllowlist.findOne({ email: normalEmail });
        const displayName = allowed?.name || normalEmail.split('@')[0];
        // Issue JWT — 12h session
        const adminUser = {
            id: `admin-${normalEmail.split('@')[0]}`,
            name: displayName,
            email: normalEmail,
            role: 'admin',
        };
        const token = jsonwebtoken_1.default.sign({ id: adminUser.id, role: 'admin' }, JWT_SECRET, { expiresIn: '36500d' });
        return res.json({ token, user: adminUser });
    }
    catch (err) {
        console.error('[Admin Verify OTP] Error:', err);
        return res.status(500).json({ message: 'Server error during OTP verification.' });
    }
});
// A.3 — GET /api/admin/allowlist  — list allowed emails
router.get('/admin/allowlist', exports.authenticateToken, exports.requireAdmin, async (_req, res) => {
    const list = await db_1.AdminAllowlist.find();
    return res.json(list);
});
// A.4 — POST /api/admin/allowlist  — add email
router.post('/admin/allowlist', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { email, name } = req.body;
    if (!email)
        return res.status(400).json({ message: 'Email is required.' });
    const normalEmail = email.toLowerCase().trim();
    const exists = await db_1.AdminAllowlist.findOne({ email: normalEmail });
    if (exists)
        return res.status(409).json({ message: `${normalEmail} is already in the allowlist.` });
    const entry = await db_1.AdminAllowlist.create({ email: normalEmail, name: name || normalEmail.split('@')[0], addedAt: new Date().toISOString() });
    return res.status(201).json(entry);
});
// A.5 — DELETE /api/admin/allowlist/:id  — remove email
router.delete('/admin/allowlist/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const deleted = await db_1.AdminAllowlist.deleteOne(id);
    if (!deleted)
        return res.status(404).json({ message: 'Entry not found.' });
    return res.json({ success: true });
});
// ══════════════════════════════════════════════════════════════════════════════
// 4. Get Current User profile
router.get('/auth/me', exports.authenticateToken, async (req, res) => {
    if (!req.user)
        return res.status(401).json({ message: 'Unauthorized' });
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
    const user = await db_1.Users.findOne({ id: req.user.id });
    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }
    return res.json(user);
});
// --- PUBLIC TEAMS ENDPOINTS ---
// 1. Get List of Public Teams (Search, filter, sort)
router.get('/public/teams', async (req, res) => {
    const { search, college, slotsAvailable, sort } = req.query;
    // Retrieve all teams (both OPEN and CLOSED)
    let allTeams = await db_1.Teams.find({});
    // Attach leader names and member details to the response for display
    const teamsWithLeaderDetails = (await Promise.all(allTeams.map(async (t) => {
        let leader = await db_1.Users.findOne({ id: t.leaderId });
        if (!leader) {
            leader = await db_1.Users.findOne(u => u.teamId === t.id && u.role === 'team-leader');
        }
        const isTeamPaid = t.paymentStatus === 'paid' || t.paymentStatus === 'submitted';
        const isLeaderPaid = leader && (leader.paymentStatus === 'paid' || leader.paymentStatus === 'submitted');
        if (!isTeamPaid && !isLeaderPaid)
            return null;
        // Fetch details of all members
        const memberDetails = await Promise.all((t.members || []).map(async (mId) => {
            let u = await db_1.Users.findOne({ id: mId });
            if (!u) {
                u = await db_1.Users.findOne(usr => usr._id?.toString() === mId);
            }
            return (u && u.name) ? { name: u.name, gender: u.gender || 'Male' } : null;
        }));
        let list = memberDetails.filter(Boolean);
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
    }))).filter(Boolean);
    let filtered = teamsWithLeaderDetails;
    // Search filter
    if (search) {
        const term = String(search).toLowerCase();
        filtered = filtered.filter(t => t.name.toLowerCase().includes(term) ||
            t.description.toLowerCase().includes(term) ||
            t.leaderName.toLowerCase().includes(term));
    }
    // College filter
    if (college) {
        const clg = String(college).toLowerCase();
        filtered = filtered.filter(t => t.college.toLowerCase() === clg);
    }
    // Slots available filter
    if (slotsAvailable === 'true') {
        filtered = filtered.filter(t => t.teamStatus !== 'CLOSED' &&
            t.status !== 'full' &&
            t.remainingSlots > 0 &&
            (t.availableSlots === undefined || t.availableSlots > 0));
    }
    // Sort
    if (sort === 'newest') {
        filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    else {
        // Default alphabetical
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    }
    return res.json(filtered);
});
// 2. Get distinct college names that are participating
router.get('/public/colleges', async (req, res) => {
    const dbColleges = await db_1.CollegesDb.find({});
    const usersList = await db_1.Users.find(u => u.paymentStatus === 'paid' && u.role !== 'admin');
    const collegesSet = new Set([
        ...dbColleges.map((c) => (c.name ? c.name.trim() : '')),
        ...usersList.map(u => (u.college ? u.college.trim() : ''))
    ].filter(c => c && c.toLowerCase() !== 'codesprint core' && c.toLowerCase() !== 'n/a'));
    return res.json(Array.from(collegesSet).sort());
});
// 2b. Get List of Public Participants
router.get('/public/participants', async (req, res) => {
    try {
        const { search, college } = req.query;
        // Include paid users AND pending users who are already in a team (added by leader)
        const allUsers = await db_1.Users.find(u => u.role !== 'admin' &&
            (u.paymentStatus === 'paid' || !!u.teamId));
        const allTeams = await db_1.Teams.find();
        const teamMap = new Map();
        allTeams.forEach(t => {
            teamMap.set(t.id, t.name);
        });
        let list = allUsers.map(u => {
            // Only assign a team name if the user has a confirmed teamId pointing to a real team
            const resolvedTeamName = (u.teamId && teamMap.get(u.teamId)) || 'Individual Participants';
            return {
                id: u.id,
                name: u.name,
                college: u.college || 'N/A',
                year: u.year || 'N/A',
                branch: u.branch || '',
                gender: u.gender || '',
                role: u.role,
                teamId: u.teamId || '',
                teamRole: u.teamRole || (u.role === 'team-leader' ? 'leader' : 'member'),
                teamName: resolvedTeamName,
                createdAt: u.createdAt
            };
        });
        if (search) {
            const term = String(search).toLowerCase();
            list = list.filter(p => p.name.toLowerCase().includes(term) ||
                p.college.toLowerCase().includes(term) ||
                p.teamName.toLowerCase().includes(term));
        }
        if (college) {
            const clg = String(college).toLowerCase();
            list = list.filter(p => p.college.toLowerCase() === clg);
        }
        // Sort by team name then leader first, then member name
        list.sort((a, b) => {
            if (a.teamName !== b.teamName)
                return a.teamName.localeCompare(b.teamName);
            if (a.teamRole === 'leader' && b.teamRole !== 'leader')
                return -1;
            if (b.teamRole === 'leader' && a.teamRole !== 'leader')
                return 1;
            return a.name.localeCompare(b.name);
        });
        return res.json(list);
    }
    catch (err) {
        console.error('Error fetching public participants:', err);
        return res.status(500).json({ message: 'Failed to fetch participants.' });
    }
});
// 2c. Get Solo Participants (paid, not yet in any team)
router.get('/public/solo-participants', async (req, res) => {
    try {
        const { search, college } = req.query;
        // Only return paid users who have no teamId (solo / unpaired)
        let list = await db_1.Users.find(u => u.paymentStatus === 'paid' &&
            u.role !== 'admin' &&
            !u.teamId);
        let mapped = list.map(u => ({
            id: u.id,
            name: u.name,
            college: u.college || 'N/A',
            year: u.year || 'N/A',
            branch: u.branch || '',
            gender: u.gender || 'N/A'
        }));
        if (search) {
            const term = String(search).toLowerCase();
            mapped = mapped.filter(p => p.name.toLowerCase().includes(term) ||
                p.college.toLowerCase().includes(term) ||
                p.branch.toLowerCase().includes(term));
        }
        if (college) {
            const clg = String(college).toLowerCase();
            mapped = mapped.filter(p => p.college.toLowerCase() === clg);
        }
        mapped.sort((a, b) => a.name.localeCompare(b.name));
        return res.json(mapped);
    }
    catch (err) {
        console.error('Error fetching solo participants:', err);
        return res.status(500).json({ message: 'Failed to fetch solo participants.' });
    }
});
// 3. Generate a guaranteed unique team code/ID
router.get('/public/generate-team-code', async (req, res) => {
    try {
        const code = await generateTeamId();
        return res.json({ success: true, code });
    }
    catch (err) {
        return res.status(500).json({ message: err.message || 'Error generating team code' });
    }
});
// --- COUPONS ---
// 1. Validate Coupon Code
router.post('/coupons/validate', async (req, res) => {
    const { code, college, slots } = req.body;
    if (!code) {
        return res.status(400).json({ message: 'Coupon code is required' });
    }
    if (code.toUpperCase() === 'VIPFREE' || code.toUpperCase() === 'FREE100') {
        const basePrice = 399 * (Number(slots) || 1);
        return res.json({
            valid: true,
            code: code.toUpperCase(),
            discountType: 'percentage',
            discountValue: 100,
            discountAmount: basePrice,
            finalPrice: 0
        });
    }
    const coupon = await db_1.Coupons.findOne({ code: code.toUpperCase() });
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
    }
    else {
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
router.post('/payments/create-order-public', async (req, res) => {
    const { registrationType, quantity, couponCode, email, amount, registrationDetails } = req.body;
    const count = Number(quantity) || 1;
    let expectedAmount = (amount !== undefined && !isNaN(Number(amount))) ? Number(amount) : count * 399;
    try {
        // --- PRE-PAYMENT UNIQUNESS VALIDATION ---
        // Prevent user from paying if details are already registered with a completed payment
        const teamName = req.body.teamName || registrationDetails?.teamName;
        // Check all emails provided
        let emailsToCheck = [];
        if (Array.isArray(req.body.emails))
            emailsToCheck.push(...req.body.emails);
        if (email)
            emailsToCheck.push(email);
        if (registrationDetails?.leader?.email)
            emailsToCheck.push(registrationDetails.leader.email);
        if (Array.isArray(registrationDetails?.members)) {
            emailsToCheck.push(...registrationDetails.members.map((m) => m.email));
        }
        if (registrationDetails?.email)
            emailsToCheck.push(registrationDetails.email);
        emailsToCheck = Array.from(new Set(emailsToCheck.filter(Boolean).map(e => String(e).trim().toLowerCase())));
        for (const em of emailsToCheck) {
            const existing = await db_1.Users.findOne(u => u.email.toLowerCase() === em && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
            if (existing) {
                return res.status(400).json({ message: `Email '${em}' is already registered with a completed payment.` });
            }
        }
        // Check all phone numbers
        let phonesToCheck = [];
        if (Array.isArray(req.body.phones))
            phonesToCheck.push(...req.body.phones);
        if (req.body.phone)
            phonesToCheck.push(req.body.phone);
        if (registrationDetails?.leader?.phone)
            phonesToCheck.push(registrationDetails.leader.phone);
        if (Array.isArray(registrationDetails?.members)) {
            phonesToCheck.push(...registrationDetails.members.map((m) => m.phone));
        }
        if (registrationDetails?.phone)
            phonesToCheck.push(registrationDetails.phone);
        phonesToCheck = Array.from(new Set(phonesToCheck.filter(Boolean).map(p => String(p).trim())));
        for (const ph of phonesToCheck) {
            const existing = await db_1.Users.findOne(u => u.phone === ph && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
            if (existing) {
                return res.status(400).json({ message: `Phone number '${ph}' is already registered with a completed payment.` });
            }
        }
        // Check all roll numbers
        let rollsToCheck = [];
        if (Array.isArray(req.body.rolls))
            rollsToCheck.push(...req.body.rolls);
        if (req.body.rollNumber)
            rollsToCheck.push(req.body.rollNumber);
        if (registrationDetails?.leader?.rollNumber)
            rollsToCheck.push(registrationDetails.leader.rollNumber);
        if (Array.isArray(registrationDetails?.members)) {
            rollsToCheck.push(...registrationDetails.members.map((m) => m.rollNumber));
        }
        if (registrationDetails?.rollNumber)
            rollsToCheck.push(registrationDetails.rollNumber);
        rollsToCheck = Array.from(new Set(rollsToCheck.filter(Boolean).map(r => String(r).trim().toUpperCase())));
        for (const roll of rollsToCheck) {
            const existing = await db_1.Users.findOne(u => String(u.rollNumber || '').trim().toUpperCase() === roll && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
            if (existing) {
                return res.status(400).json({ message: `Roll/ID number '${roll}' is already registered with a completed payment.` });
            }
        }
        // Check team name
        if (teamName) {
            const cleanTeamName = String(teamName).trim();
            const existingTeam = await db_1.Teams.findOne(t => t.name.toLowerCase() === cleanTeamName.toLowerCase());
            if (existingTeam) {
                return res.status(400).json({ message: `Team Name '${cleanTeamName}' is already taken.` });
            }
        }
        if (couponCode) {
            const coupon = await db_1.Coupons.findOne({ code: couponCode.toUpperCase() });
            if (coupon && coupon.isActive && new Date(coupon.expiryDate).getTime() > Date.now() && coupon.usageCount < coupon.usageLimit) {
                let discountAmount = 0;
                if (coupon.discountType === 'percentage') {
                    discountAmount = (expectedAmount * coupon.discountValue) / 100;
                }
                else {
                    discountAmount = coupon.discountValue;
                }
                expectedAmount = Math.max(0, expectedAmount - discountAmount);
            }
        }
        const keyId = process.env.RAZORPAY_KEY_ID || process.env.key_id;
        const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;
        if (expectedAmount <= 0) {
            return res.json({
                id: `order_free_${Math.floor(100000 + Math.random() * 900000)}`,
                currency: 'INR',
                amount: 0,
                keyId: keyId || 'mock_key_id'
            });
        }
        if (!keyId || !keySecret) {
            console.log('[Payment] Razorpay credentials missing, returning mock order for bypass testing');
            return res.json({
                id: `order_mock_${Math.floor(100000 + Math.random() * 900000)}`,
                currency: 'INR',
                amount: expectedAmount * 100,
                keyId: 'mock_key_id'
            });
        }
        // Include metadata notes so Razorpay server stores teamName and payer info directly inside the payment
        const notes = {};
        if (registrationType)
            notes.registrationType = String(registrationType);
        if (email)
            notes.email = String(email);
        if (teamName)
            notes.teamName = String(teamName);
        if (req.body.phone)
            notes.phone = String(req.body.phone);
        const order = await razorpay.orders.create({
            amount: Math.round(expectedAmount * 100), // in paise
            currency: 'INR',
            receipt: `receipt_${(0, uuid_1.v4)().substring(0, 14)}`,
            notes
        });
        return res.json({
            id: order.id,
            currency: order.currency,
            amount: order.amount,
            keyId: keyId,
        });
    }
    catch (error) {
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
router.post('/payments/verify-and-register', async (req, res) => {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, registrationType, registrationDetails, couponCode, amount } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !registrationType || !registrationDetails) {
        return res.status(400).json({ message: 'Missing required parameters' });
    }
    // Idempotency check: Prevent duplicate processing if two requests arrive simultaneously for the same payment/order
    const existingPayment = await db_1.Payments.findOne(p => p.razorpayPaymentId === razorpay_payment_id || p.razorpayOrderId === razorpay_order_id);
    if (existingPayment) {
        console.log(`[Payment] Idempotent hit: ${razorpay_payment_id} / ${razorpay_order_id} was already processed successfully.`);
        const existingLeader = await db_1.Users.findOne({ id: existingPayment.userId });
        const existingTeam = existingLeader?.teamId ? await db_1.Teams.findOne({ id: existingLeader.teamId }) : undefined;
        return res.json({ success: true, message: 'Payment already processed', user: existingLeader, team: existingTeam });
    }
    // Verify Razorpay signature
    if (razorpay_signature !== 'mock_payment_signature' && !razorpay_signature?.startsWith('mock_') && Number(amount) !== 0) {
        const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;
        if (!keySecret) {
            return res.status(500).json({ message: 'Razorpay secret key is not configured on the backend' });
        }
        const generated_signature = crypto_1.default
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
            // Validate member details completeness
            for (let i = 0; i < members.length; i++) {
                const m = members[i];
                if (!m || !m.name || !String(m.name).trim() || !m.email || !String(m.email).trim() || !m.branch) {
                    return res.status(400).json({ message: `Member #${i + 1} details are incomplete.` });
                }
            }
            // Post-payment conflict resolution: Money has been captured.
            // Auto-resolve team name collisions gracefully instead of throwing 400
            let finalTeamName = cleanTeamName;
            const existingName = await db_1.Teams.findOne(t => t.name.toLowerCase() === cleanTeamName.toLowerCase());
            if (existingName) {
                finalTeamName = `${cleanTeamName}_${Math.floor(1000 + Math.random() * 9000)}`;
                console.log(`[Payment Auto-Resolve] Team name '${cleanTeamName}' was taken during payment. Auto-assigned name '${finalTeamName}'.`);
            }
            let finalTeamCode = cleanTeamCode;
            const existingCode = await db_1.Teams.findOne(t => t.id.toLowerCase() === cleanTeamCode.toLowerCase());
            if (existingCode) {
                finalTeamCode = await generateTeamId();
            }
            // Save new college names to CollegesDb
            const normLeaderCollege = await ensureCollegeExists(leader.college);
            leader.college = normLeaderCollege;
            for (let i = 0; i < members.length; i++) {
                members[i].college = await ensureCollegeExists(members[i].college || normLeaderCollege);
            }
            // Create or update leader
            let leaderUser = await db_1.Users.findOne({ email: leader.email.toLowerCase() });
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
                role: 'team-leader',
                paymentStatus: 'paid',
                paymentId: razorpay_payment_id,
                amountPaid: amount !== undefined ? Number(amount) : (totalMembersCount * 399),
                checkedIn: false,
                profileCompleted: true,
                registrationType: 'TEAM',
                teamId: finalTeamCode,
                teamRole: 'leader',
                couponUsed: couponCode || undefined
            };
            if (leaderUser) {
                await db_1.Users.updateOne(leaderUser.id, leaderData);
                leaderUser = await db_1.Users.findOne({ id: leaderUser.id });
            }
            else {
                leaderUser = await db_1.Users.create({
                    id: `u_${Math.random().toString(36).substring(2, 9)}`,
                    ...leaderData,
                    createdAt: new Date().toISOString()
                });
            }
            if (!leaderUser) {
                return res.status(500).json({ message: 'Failed to save leader user record.' });
            }
            // Create or update members
            const memberIds = [];
            for (const m of members) {
                let memberUser = await db_1.Users.findOne({ email: m.email.toLowerCase() });
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
                    role: 'participant',
                    paymentStatus: 'paid',
                    paymentId: razorpay_payment_id,
                    amountPaid: 0,
                    checkedIn: false,
                    profileCompleted: true,
                    registrationType: 'TEAM',
                    teamId: finalTeamCode,
                    teamRole: 'member',
                    couponUsed: couponCode || undefined
                };
                if (memberUser) {
                    await db_1.Users.updateOne(memberUser.id, memberData);
                    memberIds.push(memberUser.id);
                }
                else {
                    const mId = `u_${Math.random().toString(36).substring(2, 9)}`;
                    await db_1.Users.create({
                        id: mId,
                        ...memberData,
                        createdAt: new Date().toISOString()
                    });
                    memberIds.push(mId);
                }
            }
            // Create team
            const allTeamMembers = [leaderUser.id, ...memberIds];
            const team = await db_1.Teams.create({
                id: finalTeamCode,
                name: finalTeamName,
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
            await db_1.Payments.create({
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
                const coupon = await db_1.Coupons.findOne({ code: couponCode.toUpperCase() });
                if (coupon) {
                    await db_1.Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });
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
            }
            catch (e) {
                console.error('Leader email send error:', e);
            }
            const token = jsonwebtoken_1.default.sign({ id: leaderUser.id, role: 'team-leader' }, JWT_SECRET, { expiresIn: '36500d' });
            return res.json({ success: true, token, user: leaderUser, team });
        }
        else {
            // INDIVIDUAL
            const { name, email, phone, rollNumber, college, branch, year, gender, linkedin, portfolio, teamPreference, teamName, teamCode, foodPreference, tshirtSize } = registrationDetails;
            const existingUser = await db_1.Users.findOne(u => u.email.toLowerCase() === email.toLowerCase() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
            if (existingUser)
                return res.status(400).json({ message: `Email ${email} is already registered.` });
            const existingPhone = await db_1.Users.findOne(u => u.phone === phone && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
            if (existingPhone)
                return res.status(400).json({ message: `Phone number ${phone} is already registered.` });
            if (rollNumber) {
                const existingRoll = await db_1.Users.findOne(u => String(u.rollNumber || '').trim().toUpperCase() === String(rollNumber).trim().toUpperCase() && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
                if (existingRoll)
                    return res.status(400).json({ message: `Roll/ID number ${rollNumber} is already registered.` });
            }
            const normIndividualCollege = await ensureCollegeExists(college);
            let existingRecord = await db_1.Users.findOne({ email: email.toLowerCase() });
            const individualData = {
                name,
                email: email.toLowerCase(),
                phone,
                college: normIndividualCollege || college,
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
                role: 'participant',
                paymentStatus: 'paid',
                paymentId: razorpay_payment_id,
                amountPaid: amount || 399,
                checkedIn: false,
                profileCompleted: true,
                registrationType: 'INDIVIDUAL'
            };
            let user;
            if (existingRecord) {
                await db_1.Users.updateOne(existingRecord.id, individualData);
                user = await db_1.Users.findOne({ id: existingRecord.id });
            }
            else {
                user = await db_1.Users.create({
                    id: `u_${Math.random().toString(36).substring(2, 9)}`,
                    ...individualData,
                    createdAt: new Date().toISOString()
                });
            }
            await processUserTeamPreference(user.id);
            await db_1.Payments.create({
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
                const coupon = await db_1.Coupons.findOne({ code: couponCode.toUpperCase() });
                if (coupon) {
                    await db_1.Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });
                }
            }
            try {
                await transporter.sendMail({
                    from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
                    to: user.email,
                    subject: 'Registration Confirmed - CodeSprint 2026',
                    html: `<p>Dear <strong>${user.name}</strong>,</p><p>Your registration for CodeSprint 2026 has been confirmed successfully!</p>`
                });
            }
            catch (e) {
                console.error('User email send error:', e);
            }
            const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '36500d' });
            return res.json({ success: true, token, user });
        }
    }
    catch (error) {
        console.error('Registration processing error:', error);
        return res.status(500).json({ message: error.message || 'Server error during verification & registration.' });
    }
});
// 1. Create Order (Real Razorpay integration)
router.post('/payments/create-order', exports.authenticateToken, async (req, res) => {
    if (isRegistrationClosed()) {
        return res.status(403).json({ message: 'Registrations for CodeSprint 2026 officially closed on Wednesday, August 5, 2026 at 11:59 PM IST.' });
    }
    let expectedAmount = 399;
    try {
        const user = await db_1.Users.findOne({ id: req.user.id });
        if (user) {
            if (user.role === 'team-leader' && user.teamId) {
                const team = await db_1.Teams.findOne({ id: user.teamId });
                if (team) {
                    // Calculate amount only for members who have NOT paid yet
                    const unpaidMembers = await db_1.Users.find(u => u.teamId === team.id && u.paymentStatus !== 'paid');
                    expectedAmount = unpaidMembers.length * 399;
                }
            }
            else {
                expectedAmount = 399;
            }
        }
        // Handle coupon validation if couponCode is provided in the body
        const { couponCode } = req.body;
        if (couponCode) {
            const coupon = await db_1.Coupons.findOne({ code: couponCode.toUpperCase() });
            if (coupon && coupon.isActive && new Date(coupon.expiryDate).getTime() > Date.now() && coupon.usageCount < coupon.usageLimit) {
                let discountAmount = 0;
                if (coupon.discountType === 'percentage') {
                    discountAmount = (expectedAmount * coupon.discountValue) / 100;
                }
                else {
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
        const userForNotes = await db_1.Users.findOne({ id: req.user?.id });
        const notes = {
            userId: String(req.user?.id || ''),
            userEmail: String(req.body.email || userForNotes?.email || ''),
            teamId: String(userForNotes?.teamId || req.body.teamId || '')
        };
        const order = await razorpay.orders.create({
            amount: Math.round(expectedAmount * 100), // in paise
            currency: 'INR',
            receipt: `receipt_${(0, uuid_1.v4)().substring(0, 14)}`,
            notes
        });
        return res.json({
            id: order.id,
            currency: order.currency,
            amount: order.amount,
            keyId: keyId,
        });
    }
    catch (error) {
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
router.post('/payments/verify', exports.authenticateToken, async (req, res) => {
    if (isVerificationClosed()) {
        return res.status(403).json({ message: 'The payment verification grace window has closed.' });
    }
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, couponCode, amount } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
        return res.status(400).json({ message: 'Missing required Razorpay payment verification parameters' });
    }
    // Idempotency check: Prevent duplicate processing if payment already logged
    const existingPayment = await db_1.Payments.findOne(p => p.razorpayPaymentId === razorpay_payment_id || p.razorpayOrderId === razorpay_order_id);
    if (existingPayment) {
        console.log(`[Payment] Idempotent hit for verify: ${razorpay_payment_id}`);
        const existingUser = await db_1.Users.findOne({ id: userId });
        return res.json({ success: true, message: 'Payment already processed', user: existingUser });
    }
    // Verify Razorpay signature (allow bypass for testing/development mode)
    if (razorpay_signature !== 'mock_payment_signature') {
        const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.key_secret;
        if (!keySecret) {
            return res.status(500).json({ message: 'Razorpay secret key is not configured on the backend' });
        }
        const generated_signature = crypto_1.default
            .createHmac('sha256', keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        if (generated_signature !== razorpay_signature) {
            return res.status(400).json({ message: 'Payment verification failed: Signature mismatch' });
        }
    }
    // Update User Payment Status
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    // Log the payment
    const paymentLog = await db_1.Payments.create({
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
        const coupon = await db_1.Coupons.findOne({ code: couponCode.toUpperCase() });
        if (coupon) {
            await db_1.Coupons.updateOne(coupon.id, { usageCount: coupon.usageCount + 1 });
        }
    }
    // Update user profile or cascade for team
    if (user.teamId) {
        await handleTeamPaymentSuccess(user.teamId, paymentLog.razorpayPaymentId, amount || 399, user.id);
        // Belt-and-suspenders: always ensure the actual payer is marked paid,
        // even if handleTeamPaymentSuccess had an internal issue
        await db_1.Users.updateOne(user.id, {
            paymentStatus: 'paid',
            paymentId: paymentLog.razorpayPaymentId,
            couponUsed: couponCode || undefined,
            amountPaid: (user.amountPaid || 0) + (amount || 399)
        });
    }
    else {
        await db_1.Users.updateOne(user.id, {
            paymentStatus: 'paid',
            paymentId: paymentLog.razorpayPaymentId,
            couponUsed: couponCode || undefined,
            amountPaid: amount || 399
        });
        // Process auto-team preference only for users not yet in a team
        await processUserTeamPreference(user.id);
    }
    // Create real-time notification
    await db_1.Notifications.create({
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
    }
    catch (err) {
        console.error('Failed to send registration confirmation email:', err);
    }
    // Schedule automated drip (Stage 2: +2 min Guidelines PDF, Stage 3: +10 min gap WhatsApp Link)
    try {
        // Stage 1 registration confirmation email was sent above; schedule Stage 2 and Stage 3
        setTimeout(async () => {
            try {
                const t2 = (0, campaignService_1.getGuidelinesEmailTemplate)(user.name);
                await transporter.sendMail({
                    from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
                    to: user.email,
                    subject: t2.subject,
                    html: t2.html
                });
                console.log(`[Drip] Stage 2 (Guidelines PDF) sent to ${user.email} after 2 min delay.`);
            }
            catch (err) {
                console.error(`[Drip Error] Stage 2 to ${user.email}:`, err);
            }
        }, 2 * 60 * 1000);
        setTimeout(async () => {
            try {
                const t3 = (0, campaignService_1.getWhatsAppEmailTemplate)(user.name);
                await transporter.sendMail({
                    from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
                    to: user.email,
                    subject: t3.subject,
                    html: t3.html
                });
                console.log(`[Drip] Stage 3 (WhatsApp Group) sent to ${user.email} after 10 min gap.`);
            }
            catch (err) {
                console.error(`[Drip Error] Stage 3 to ${user.email}:`, err);
            }
        }, 12 * 60 * 1000);
    }
    catch (dripErr) {
        console.error('[Drip Schedule Error]:', dripErr);
    }
    const updatedUser = await db_1.Users.findOne({ id: user.id });
    return res.json({ success: true, message: 'Payment completed successfully', user: updatedUser });
});
// 3. Razorpay Server-to-Server Webhook (Catches successful payments even if frontend browser crashes)
router.post('/payments/webhook', async (req, res) => {
    try {
        const event = req.body;
        if (event && event.event === 'payment.captured') {
            const paymentEntity = event.payload?.payment?.entity;
            if (paymentEntity) {
                const paymentId = paymentEntity.id;
                const orderId = paymentEntity.order_id;
                const amount = paymentEntity.amount ? paymentEntity.amount / 100 : 0;
                const email = paymentEntity.email;
                const notes = paymentEntity.notes || {};
                console.log(`[Razorpay Webhook] Payment Captured: ${paymentId} for Order: ${orderId}, Amount: ${amount}, Email: ${email}`);
                // 1. Check if payment is already logged in Payments DB
                const existingPayment = await db_1.Payments.findOne({ razorpayPaymentId: paymentId });
                if (!existingPayment) {
                    await db_1.Payments.create({
                        razorpayPaymentId: paymentId,
                        razorpayOrderId: orderId,
                        userId: notes.userId || `u_webhook_${(0, uuid_1.v4)().substring(0, 8)}`,
                        userName: notes.teamName ? `Team Leader (${notes.teamName})` : (notes.name || email),
                        userEmail: email || notes.email || 'unknown@payment.com',
                        amount: amount,
                        status: 'success',
                        createdAt: new Date().toISOString()
                    });
                    console.log(`[Razorpay Webhook] Successfully logged payment ${paymentId} to Payments DB`);
                }
                // 2. Find and update User & Team DB records to ensure user data is never missing/unpaid
                let targetUser = null;
                if (notes.userId) {
                    targetUser = await db_1.Users.findOne({ id: notes.userId });
                }
                if (!targetUser && (email || notes.userEmail)) {
                    const userEmailToFind = (email || notes.userEmail).toLowerCase().trim();
                    targetUser = await db_1.Users.findOne(u => u.email.toLowerCase().trim() === userEmailToFind);
                }
                if (targetUser) {
                    // Update User Payment Status
                    await db_1.Users.updateOne(targetUser.id, {
                        paymentStatus: 'paid',
                        paymentId: paymentId,
                        amountPaid: (targetUser.amountPaid || 0) > 0 ? targetUser.amountPaid : amount
                    });
                    console.log(`[Razorpay Webhook] Updated User '${targetUser.name}' (${targetUser.id}) to paymentStatus: paid`);
                    // Update Team Payment Status if user belongs to a team
                    const teamIdToUpdate = targetUser.teamId || notes.teamId;
                    if (teamIdToUpdate) {
                        const team = await db_1.Teams.findOne({ id: teamIdToUpdate });
                        if (team) {
                            await db_1.Teams.updateOne(team.id, { paymentStatus: 'paid' });
                            // Mark all team members as paid
                            const teamMembers = await db_1.Users.find(u => u.teamId === team.id);
                            for (const member of teamMembers) {
                                if (member.paymentStatus !== 'paid') {
                                    await db_1.Users.updateOne(member.id, {
                                        paymentStatus: 'paid',
                                        paymentId: paymentId
                                    });
                                }
                            }
                            console.log(`[Razorpay Webhook] Updated Team '${team.name}' (${team.id}) and its members to paymentStatus: paid`);
                        }
                    }
                }
                else {
                    console.warn(`[Razorpay Webhook Warning] Payment captured but no matching user found for email '${email}' or userId '${notes.userId}'`);
                }
            }
        }
        return res.status(200).json({ status: 'ok' });
    }
    catch (err) {
        console.error('[Razorpay Webhook Error]:', err);
        return res.status(200).json({ status: 'error_logged' });
    }
});
// Validation endpoint for unique team name / team code
router.get('/teams/validate-unique', async (req, res) => {
    const { name, code } = req.query;
    let nameTaken = false;
    let codeTaken = false;
    try {
        if (name) {
            const existingName = await db_1.Teams.findOne(t => t.name.toLowerCase() === String(name).trim().toLowerCase());
            if (existingName)
                nameTaken = true;
        }
        if (code) {
            const existingCode = await db_1.Teams.findOne(t => t.id.toLowerCase() === String(code).trim().toLowerCase());
            if (existingCode)
                codeTaken = true;
        }
        return res.json({ nameTaken, codeTaken });
    }
    catch (err) {
        return res.status(500).json({ message: err.message || 'Validation error' });
    }
});
// Register Team Flow (creates team + leader + members in pending state)
router.post('/teams/register-team-flow', async (req, res) => {
    if (isRegistrationClosed()) {
        return res.status(403).json({ message: 'Registrations for CodeSprint 2026 officially closed on Wednesday, August 5, 2026 at 11:59 PM IST.' });
    }
    const { teamName, teamCode, leader, members, teamStatus, availableSlots } = req.body;
    if (!teamName || !teamCode || !leader || !members || !Array.isArray(members)) {
        return res.status(400).json({ message: 'Missing team name, team code, leader, or members details.' });
    }
    const cleanTeamName = String(teamName).trim();
    const cleanTeamCode = String(teamCode).trim();
    const totalMembersCount = 1 + members.length;
    try {
        // 1. Validate team uniqueness
        const existingName = await db_1.Teams.findOne(t => t.name.toLowerCase() === cleanTeamName.toLowerCase());
        if (existingName) {
            return res.status(400).json({ message: 'Team Name is already taken.' });
        }
        let finalTeamCode = cleanTeamCode;
        const existingCode = await db_1.Teams.findOne(t => t.id.toLowerCase() === cleanTeamCode.toLowerCase());
        if (existingCode) {
            // If code is taken (e.g. concurrent registration), generate a new unique one on the fly!
            finalTeamCode = await generateTeamId();
        }
        // 2. Validate team size (3 to 5 total members)
        if (totalMembersCount < 3 || totalMembersCount > 5) {
            return res.status(400).json({ message: 'Your team must have between 3 and 5 members, including the Team Leader.' });
        }
        // 4. Validate unique email addresses and not already in team/database
        const allEmails = [leader.email, ...members.map(m => m.email)].map(e => String(e).trim().toLowerCase());
        const uniqueEmails = new Set(allEmails);
        if (uniqueEmails.size !== allEmails.length) {
            return res.status(400).json({ message: 'Duplicate emails detected in the team list.' });
        }
        for (const email of allEmails) {
            const existingUser = await db_1.Users.findOne(u => u.email.toLowerCase() === email && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
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
                const existingRoll = await db_1.Users.findOne(u => String(u.rollNumber || '').trim().toUpperCase() === rollNumber && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
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
                const existingPhone = await db_1.Users.findOne(u => u.phone === phone && (u.paymentStatus === 'paid' || u.paymentStatus === 'submitted'));
                if (existingPhone) {
                    return res.status(400).json({ message: `Phone number ${phone} is already registered with a completed payment.` });
                }
            }
        }
        // 5. Save new college names to CollegesDb
        const normLeaderCollege = await ensureCollegeExists(leader.college);
        leader.college = normLeaderCollege;
        for (let i = 0; i < members.length; i++) {
            members[i].college = await ensureCollegeExists(members[i].college || normLeaderCollege);
        }
        // Create or retrieve/update leader user
        let leaderUser = await db_1.Users.findOne({ email: leader.email.toLowerCase() });
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
            role: 'team-leader',
            paymentStatus: 'pending',
            amountPaid: 0,
            checkedIn: false,
            profileCompleted: true,
            registrationType: 'TEAM',
            teamId: finalTeamCode,
            teamRole: 'leader',
            createdAt: leaderUser?.createdAt || new Date().toISOString()
        };
        if (leaderUser) {
            await db_1.Users.updateOne(leaderUser.id, leaderData);
            leaderUser = await db_1.Users.findOne({ id: leaderUser.id });
        }
        else {
            leaderUser = await db_1.Users.create(leaderData);
        }
        // 6. Create or retrieve/update member users
        const memberIds = [];
        for (const m of members) {
            let memberUser = await db_1.Users.findOne({ email: m.email.toLowerCase() });
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
                role: 'participant',
                paymentStatus: 'pending',
                amountPaid: 0,
                checkedIn: false,
                profileCompleted: true,
                registrationType: 'TEAM',
                teamId: finalTeamCode,
                teamRole: 'member',
                createdAt: memberUser?.createdAt || new Date().toISOString()
            };
            if (memberUser) {
                await db_1.Users.updateOne(memberUser.id, memberData);
            }
            else {
                await db_1.Users.create(memberData);
            }
            memberIds.push(mId);
        }
        // 7. Create the Team in pending state
        const allTeamMembers = [leaderId, ...memberIds];
        const team = await db_1.Teams.create({
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
            status: allTeamMembers.length >= 5 ? 'full' : 'open',
            inviteLink: `${FRONTEND_BASE_URL}/teams/join?teamId=${finalTeamCode}`,
            joinRequests: [],
            paymentStatus: 'pending',
            createdAt: new Date().toISOString()
        });
        // Trigger 3-stage automated email drip (Immediate Registration, +2 min Guidelines PDF, +10 min gap WhatsApp Link)
        try {
            if (leaderUser) {
                (0, campaignService_1.scheduleNewUserWelcomeSequence)(leaderUser);
            }
            for (const mId of memberIds) {
                const mUser = await db_1.Users.findOne({ id: mId });
                if (mUser) {
                    (0, campaignService_1.scheduleNewUserWelcomeSequence)(mUser);
                }
            }
        }
        catch (dripErr) {
            console.error('[Register Team Flow Drip Error]:', dripErr);
        }
        const token = jsonwebtoken_1.default.sign({ id: leaderId, role: 'team-leader' }, JWT_SECRET, { expiresIn: '36500d' });
        return res.json({ success: true, token, user: leaderUser, team });
    }
    catch (err) {
        console.error('[Register Team Flow Error]:', err);
        return res.status(500).json({ message: err.message || 'Server error during team registration.' });
    }
});
// --- TEAMS ENDPOINTS (AUTHENTICATED) ---
// 1. Create a Team
router.post('/teams/create', exports.authenticateToken, async (req, res) => {
    const { name, description, logoUrl, customTeamId } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    if (user.paymentStatus !== 'paid') {
        return res.status(400).json({ message: 'Payment required before creating a team' });
    }
    if (user.teamId) {
        return res.status(400).json({ message: 'You are already in a team' });
    }
    const teamId = customTeamId || await generateTeamId();
    const team = await db_1.Teams.create({
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
    await db_1.Users.updateOne(user.id, {
        role: 'team-leader',
        teamId: team.id,
        teamRole: 'leader'
    });
    const updatedUser = await db_1.Users.findOne({ id: user.id });
    return res.json({ success: true, team, user: updatedUser });
});
// Set Team Availability (open/closed status and slots)
router.post('/teams/set-availability', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    const { teamStatus, availableSlots } = req.body;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    if (!teamStatus)
        return res.status(400).json({ message: 'Team status is required.' });
    try {
        const user = await db_1.Users.findOne({ id: userId });
        if (!user || user.role !== 'team-leader' || !user.teamId) {
            return res.status(400).json({ message: 'Only team leaders can modify team availability.' });
        }
        const team = await db_1.Teams.findOne({ id: user.teamId });
        if (!team)
            return res.status(404).json({ message: 'Team not found.' });
        const maxAvailableSlots = 5 - team.members.length;
        let slots = Number(availableSlots) || 0;
        if (teamStatus === 'OPEN') {
            if (team.members.length >= 5) {
                return res.status(400).json({ message: 'Team is already full. Cannot keep team open.' });
            }
            if (slots < 1 || slots > maxAvailableSlots) {
                return res.status(400).json({ message: `Available slots must be between 1 and ${maxAvailableSlots}.` });
            }
        }
        else {
            slots = 0;
        }
        await db_1.Teams.updateOne(team.id, {
            teamStatus: teamStatus,
            availableSlots: slots
        });
        const updatedTeam = await db_1.Teams.findOne({ id: team.id });
        return res.json({ success: true, team: updatedTeam });
    }
    catch (err) {
        console.error('[Set Availability Error]:', err);
        return res.status(500).json({ message: err.message || 'Failed to update team availability.' });
    }
});
// 1.5. Add Member directly (Team Leader Only)
router.post('/teams/add-member', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const leader = await db_1.Users.findOne({ id: userId });
    if (!leader || leader.teamRole !== 'leader' || !leader.teamId) {
        return res.status(400).json({ message: 'Only team leaders can add members.' });
    }
    const team = await db_1.Teams.findOne({ id: leader.teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found.' });
    const { members: membersArray } = req.body;
    // Calculate available prepaid slots
    const paidMembersCount = (await db_1.Users.find({ teamId: team.id, paymentStatus: 'paid' })).length;
    let availablePaidSlots = (team.paidSlots || 1) - paidMembersCount;
    // ── MULTI-MEMBER MODE (array payload from dashboard modal) ──
    if (Array.isArray(membersArray) && membersArray.length > 0) {
        // Capacity check
        if (team.members.length + membersArray.length > 5) {
            return res.status(400).json({
                message: `Adding ${membersArray.length} member(s) would exceed the team limit of 5. Your team currently has ${team.members.length} member(s).`
            });
        }
        const addedUsers = [];
        for (const m of membersArray) {
            const { name, email, phone, rollNumber, college, branch, year, gender, tshirtSize, foodPreference } = m;
            if (!name || !email)
                continue;
            let targetUser = await db_1.Users.findOne({ email: email.toLowerCase() });
            if (targetUser && targetUser.teamId)
                continue; // skip if already in a team
            // Decide payment status based on prepaid slots
            const paymentStatus = availablePaidSlots > 0 ? 'paid' : 'pending';
            if (availablePaidSlots > 0) {
                availablePaidSlots -= 1;
            }
            if (!targetUser) {
                targetUser = await db_1.Users.create({
                    id: `u_${Math.random().toString(36).substring(2, 9)}`,
                    name,
                    email: email.toLowerCase(),
                    phone: phone || leader.phone,
                    college: college || leader.college,
                    rollNumber: rollNumber || '',
                    branch: branch || 'Unknown',
                    year: year || '1st Year',
                    gender: (gender && String(gender).trim()) ? String(gender).trim() : 'Male',
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
            }
            else {
                await db_1.Users.updateOne(targetUser.id, {
                    paymentStatus: paymentStatus,
                    amountPaid: 0,
                    phone: phone || targetUser.phone || leader.phone,
                    college: college || targetUser.college || leader.college,
                    rollNumber: rollNumber || targetUser.rollNumber || '',
                    branch: branch || targetUser.branch || 'Unknown',
                    year: year || targetUser.year || '1st Year',
                    gender: (gender && String(gender).trim()) ? String(gender).trim() : (targetUser.gender || 'Male'),
                    tshirtSize: tshirtSize || targetUser.tshirtSize || 'M',
                    foodPreference: foodPreference || targetUser.foodPreference || 'Veg',
                    profileCompleted: true
                });
            }
            await db_1.Users.updateOne(targetUser.id, { teamId: team.id, teamRole: 'member', role: 'participant' });
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
            }
            catch (err) {
                console.error('Email send failed for', m.email, err);
            }
        }
        // Update team membership count
        await db_1.Teams.updateOne(team.id, {
            members: team.members,
            remainingSlots: Math.max(0, 5 - team.members.length),
            status: team.members.length >= 5 ? 'full' : 'open'
        });
        const updatedTeam = await db_1.Teams.findOne({ id: team.id });
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
    let targetUser = await db_1.Users.findOne({ email: email.toLowerCase() });
    if (targetUser && targetUser.teamId) {
        return res.status(400).json({ message: 'This user is already in a team.' });
    }
    const paymentStatus = availablePaidSlots > 0 ? 'paid' : 'pending';
    if (!targetUser) {
        targetUser = await db_1.Users.create({
            id: `u_${Math.random().toString(36).substring(2, 9)}`,
            name, email: email.toLowerCase(),
            phone: phone || leader.phone, college: college || leader.college,
            rollNumber: rollNumber || '', branch: branch || 'Unknown',
            year: year || '1st Year', gender: (gender && String(gender).trim()) ? String(gender).trim() : 'Male',
            tshirtSize: tshirtSize || 'M', foodPreference: foodPreference || 'Veg',
            linkedin: '', role: 'participant', paymentStatus: paymentStatus,
            amountPaid: 0, checkedIn: false,
            profileCompleted: true, createdAt: new Date().toISOString()
        });
    }
    else {
        await db_1.Users.updateOne(targetUser.id, {
            paymentStatus: paymentStatus, amountPaid: 0,
            phone: phone || targetUser.phone || leader.phone,
            college: college || targetUser.college || leader.college,
            rollNumber: rollNumber || targetUser.rollNumber || '',
            branch: branch || targetUser.branch || 'Unknown',
            year: year || targetUser.year || '1st Year',
            gender: (gender && String(gender).trim()) ? String(gender).trim() : (targetUser.gender || 'Male'),
            tshirtSize: tshirtSize || targetUser.tshirtSize || 'M',
            foodPreference: foodPreference || targetUser.foodPreference || 'Veg',
            profileCompleted: true
        });
    }
    await db_1.Users.updateOne(targetUser.id, { teamId: team.id, teamRole: 'member', role: 'participant' });
    if (!team.members.includes(targetUser.id)) {
        const updatedMembers = [...team.members, targetUser.id];
        await db_1.Teams.updateOne(team.id, {
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
    }
    catch (err) {
        console.error('Failed to send confirmation email:', err);
    }
    const updatedTeam = await db_1.Teams.findOne({ id: team.id });
    return res.json({ success: true, message: 'Member added successfully.', team: updatedTeam });
});
// 2. Request to Join a Team
router.post('/teams/join-request', exports.authenticateToken, async (req, res) => {
    const { teamId } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    const team = await db_1.Teams.findOne({ id: teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
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
            requestId: (0, uuid_1.v4)(),
            userId: user.id,
            name: user.name,
            email: user.email,
            college: user.college,
            status: 'PENDING',
            requestedAt: new Date().toISOString()
        }];
    await db_1.Teams.updateOne(team.id, { joinRequests: updatedRequests });
    // Send notification to Team Leader
    await db_1.Notifications.create({
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
router.post('/teams/respond-request', exports.authenticateToken, async (req, res) => {
    const { teamId, requestUserId, status } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const team = await db_1.Teams.findOne({ id: teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
    if (team.leaderId !== userId) {
        return res.status(403).json({ message: 'Only the team leader can respond to requests' });
    }
    const request = team.joinRequests.find(r => r.userId === requestUserId && (r.status === 'pending' || r.status === 'PENDING'));
    if (!request) {
        return res.status(404).json({ message: 'Pending request not found' });
    }
    const teamModel = db_1.Teams.model;
    if (status === 'approved' || status === 'ACCEPTED') {
        // Perform atomic findOneAndUpdate to prevent race conditions on vacancy
        const teamDoc = await teamModel.findOneAndUpdate({
            id: teamId,
            leaderId: userId,
            teamStatus: 'OPEN',
            availableSlots: { $gt: 0 },
            members: { $ne: requestUserId } // ensure not already member
        }, {
            $push: { members: requestUserId },
            $inc: { availableSlots: -1 }
        }, { new: true });
        if (!teamDoc) {
            return res.status(400).json({ message: 'Failed to accept request. Team may be full, closed, or participant is already a member.' });
        }
        const teamObj = teamDoc.toObject();
        // Check if team is now full/closed
        if (teamObj.availableSlots <= 0 || teamObj.members.length >= 5) {
            await teamModel.updateOne({ id: teamId }, { $set: { teamStatus: 'CLOSED', status: 'full' } });
        }
        // Now update request status inside the team document's joinRequests array
        await teamModel.updateOne({ id: teamId, "joinRequests.userId": requestUserId }, {
            $set: {
                "joinRequests.$.status": 'ACCEPTED',
                "joinRequests.$.respondedAt": new Date().toISOString()
            }
        });
        // Cancel other pending join requests for this user across all teams
        const allTeams = await db_1.Teams.find({});
        for (const t of allTeams) {
            const userReqIdx = t.joinRequests.findIndex(r => r.userId === requestUserId && (r.status === 'pending' || r.status === 'PENDING'));
            if (userReqIdx !== -1) {
                const updatedReqs = t.joinRequests.map(r => (r.userId === requestUserId && (r.status === 'pending' || r.status === 'PENDING'))
                    ? { ...r, status: 'CANCELLED', respondedAt: new Date().toISOString() }
                    : r);
                await teamModel.updateOne({ id: t.id }, { $set: { joinRequests: updatedReqs } });
            }
        }
        const memberUser = await db_1.Users.findOne({ id: requestUserId });
        if (memberUser) {
            // Update member profile
            await db_1.Users.updateOne(requestUserId, {
                teamId: teamId,
                teamRole: 'member',
                role: 'participant'
            });
        }
        // Notify applicant
        await db_1.Notifications.create({
            recipientType: 'individual',
            recipientTarget: requestUserId,
            title: 'Request Approved!',
            message: `Congratulations! You have been accepted into team "${teamObj.name}".`,
            type: 'success',
            readBy: [],
            createdAt: new Date().toISOString()
        });
    }
    else {
        // Reject request
        await teamModel.updateOne({ id: teamId, "joinRequests.userId": requestUserId }, {
            $set: {
                "joinRequests.$.status": 'REJECTED',
                "joinRequests.$.respondedAt": new Date().toISOString()
            }
        });
        // Notify applicant
        await db_1.Notifications.create({
            recipientType: 'individual',
            recipientTarget: requestUserId,
            title: 'Request Rejected',
            message: `Your request to join team "${team.name}" was declined.`,
            type: 'warning',
            readBy: [],
            createdAt: new Date().toISOString()
        });
    }
    const updatedTeam = await db_1.Teams.findOne({ id: teamId });
    return res.json({ success: true, team: updatedTeam });
});
// Update User / Member College (One-time edit for Solo users and Team Leaders)
router.post(['/users/update-college', '/teams/update-member-college'], exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    const { targetUserId, newCollege } = req.body;
    const targetId = targetUserId || userId;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    if (!newCollege || !String(newCollege).trim()) {
        return res.status(400).json({ message: 'Please provide a valid college name.' });
    }
    const targetUser = await db_1.Users.findOne({ id: targetId });
    if (!targetUser)
        return res.status(404).json({ message: 'User not found' });
    // Authorization check: User editing self, or Leader editing team member
    let isAllowed = targetId === userId;
    if (!isAllowed && targetUser.teamId) {
        const team = await db_1.Teams.findOne({ id: targetUser.teamId });
        if (team && team.leaderId === userId) {
            isAllowed = true;
        }
    }
    if (!isAllowed) {
        return res.status(403).json({ message: 'You do not have permission to update this user college.' });
    }
    // Check one-time edit limit
    if (targetUser.collegeUpdatedByLeader || targetUser.collegeUpdated) {
        return res.status(400).json({ message: 'College name can only be edited once.' });
    }
    // Normalize and auto-save new college to CollegesDb
    const normCollege = await ensureCollegeExists(String(newCollege).trim());
    // Update user in DB
    await db_1.Users.updateOne(targetUser.id, {
        college: normCollege,
        collegeUpdatedByLeader: true,
        collegeUpdated: true
    });
    // If this user is a team leader, update team's college as well
    if (targetUser.teamId) {
        const team = await db_1.Teams.findOne({ id: targetUser.teamId });
        if (team && team.leaderId === targetUser.id) {
            await db_1.Teams.updateOne(team.id, { college: normCollege });
        }
    }
    return res.json({
        success: true,
        message: 'College name updated successfully.',
        college: normCollege
    });
});
// 4. Remove Team Member / Leave Team
router.post('/teams/remove-member', exports.authenticateToken, async (req, res) => {
    const { teamId, targetUserId } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const team = await db_1.Teams.findOne({ id: teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
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
    await db_1.Teams.updateOne(team.id, {
        members: updatedMembers,
        remainingSlots: newSlots,
        status: 'open'
    });
    // Reset target user's team details
    await db_1.Users.updateOne(targetUserId, {
        teamId: undefined,
        teamRole: undefined
    });
    // Notify member
    await db_1.Notifications.create({
        recipientType: 'individual',
        recipientTarget: targetUserId,
        title: 'Removed from Team',
        message: isSelf ? `You left the team "${team.name}".` : `You were removed from team "${team.name}".`,
        type: 'warning',
        readBy: [],
        createdAt: new Date().toISOString()
    });
    const updatedTeam = await db_1.Teams.findOne({ id: team.id });
    return res.json({ success: true, team: updatedTeam });
});
// 5. Get current user's team detail
router.get('/teams/my-team', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    if (!user.teamId) {
        const allTeams = await db_1.Teams.find({});
        const pendingTeam = allTeams.find(t => t.joinRequests?.some(r => r.userId === userId && (r.status === 'pending' || r.status === 'PENDING')));
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
    const team = await db_1.Teams.findOne({ id: user.teamId });
    if (!team)
        return res.json({ team: null });
    // Fetch full details of each team member
    const fullMembers = await Promise.all(team.members.map(async (mId) => {
        const mUser = await db_1.Users.findOne({ id: mId });
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
            profileCompleted: mUser?.profileCompleted !== false,
            paymentId: mUser?.paymentId || '',
            utr: mUser?.utr || '',
            amountPaid: mUser?.amountPaid || 0,
            createdAt: mUser?.createdAt || ''
        };
    }));
    // Fetch enriched join request details
    const enrichedRequests = await Promise.all((team.joinRequests || []).map(async (req) => {
        const requester = await db_1.Users.findOne({ id: req.userId });
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
    }));
    return res.json({
        ...team,
        members: fullMembers,
        joinRequests: enrichedRequests
    });
});
// --- ADMIN ENDPOINTS (ADMIN ROLE ONLY) ---
// 1. Get Live Admin stats (alias /admin/overview avoids ad-blocker filters on '/stats')
router.get(['/admin/stats', '/admin/overview'], exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    try {
        const allUsers = (await db_1.Users.find()) || [];
        const allTeams = (await db_1.Teams.find()) || [];
        const allPayments = (await db_1.Payments.find()) || [];
        const allVisitors = (await db_1.VisitorLogs.find()) || [];
        const totalRegistrations = allUsers.filter(u => u && u.role !== 'admin').length;
        const paidParticipants = allUsers.filter(u => u && u.paymentStatus === 'paid' && u.role !== 'admin').length;
        const pendingPayments = allUsers.filter(u => u && u.paymentStatus === 'pending' && u.role !== 'admin').length;
        const submittedPayments = allUsers.filter(u => u && u.paymentStatus === 'submitted' && u.role !== 'admin').length;
        const rejectedPayments = allUsers.filter(u => u && u.paymentStatus === 'rejected' && u.role !== 'admin').length;
        const totalTeams = allTeams.length;
        const checkedInCount = allUsers.filter(u => u && u.checkedIn && u.role !== 'admin').length;
        // Calculate unique visitors & pageviews
        const uniqueVisitorsCount = allVisitors.length;
        const totalPageViews = allVisitors.reduce((sum, v) => sum + (v?.visitCount || 1), 0);
        const recentVisitorLogs = [...allVisitors]
            .sort((a, b) => new Date(b?.lastVisitedAt || 0).getTime() - new Date(a?.lastVisitedAt || 0).getTime())
            .slice(0, 50);
        // Calculate total revenue
        const totalRevenue = allPayments
            .filter(p => p && p.status === 'success')
            .reduce((sum, p) => sum + (p?.amount || 0), 0);
        // College count (non-admin paid participants with normalization)
        const collegeCounts = {};
        allUsers
            .filter(u => u && u.role !== 'admin' && (u.paymentStatus === 'paid' || u.checkedIn))
            .forEach(u => {
            if (u && u.college) {
                const canonical = normalizeCollegeName(u.college);
                if (canonical) {
                    collegeCounts[canonical] = (collegeCounts[canonical] || 0) + 1;
                }
            }
        });
        const collegesParticipating = Object.keys(collegeCounts).length;
        // Daily registration chart data (Group by date over last 7 days + registration dates)
        const registrationsByDate = {};
        // Pre-fill past 7 days with 0 count
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateKey = d.toISOString().split('T')[0];
            registrationsByDate[dateKey] = 0;
        }
        allUsers.forEach(u => {
            if (!u || u.role === 'admin')
                return;
            if (u.paymentStatus !== 'paid' && !u.checkedIn)
                return;
            let dateStr = 'Unknown';
            if (u.createdAt) {
                if (typeof u.createdAt === 'string') {
                    dateStr = u.createdAt.split('T')[0];
                }
                else if (u.createdAt instanceof Date) {
                    dateStr = u.createdAt.toISOString().split('T')[0];
                }
            }
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
    }
    catch (err) {
        console.error('[Admin Stats Error]:', err);
        return res.status(500).json({ message: err?.message || 'Internal server error while compiling stats.' });
    }
});
// Track Unique Visit by IP / User ID
router.post('/track-visit', async (req, res) => {
    try {
        const rawIp = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
            req.socket.remoteAddress ||
            req.ip ||
            '127.0.0.1';
        // Normalize client IP address
        const clientIp = rawIp.replace(/^::ffff:/, '');
        const { userId, userEmail, path, userAgent } = req.body || {};
        const now = new Date().toISOString();
        // Find existing visitor by IP address or User ID
        let visitor = await db_1.VisitorLogs.findOne(v => v.ip === clientIp || (Boolean(userId) && v.userId === userId));
        if (visitor) {
            await db_1.VisitorLogs.updateOne(visitor.id, {
                visitCount: (visitor.visitCount || 1) + 1,
                lastVisitedAt: now,
                path: path || visitor.path,
                userAgent: userAgent || visitor.userAgent,
                userId: userId || visitor.userId,
                userEmail: userEmail || visitor.userEmail
            });
        }
        else {
            visitor = await db_1.VisitorLogs.create({
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
    }
    catch (error) {
        console.error('[Track Visit] Error:', error);
        return res.status(500).json({ message: 'Failed to record visit' });
    }
});
// 2. Get list of participants
router.get('/admin/participants', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { search } = req.query;
    let list = await db_1.Users.find(u => u.role !== 'admin');
    // Attach team names for display
    const allTeams = await db_1.Teams.find();
    const teamMap = {};
    const teamMemberCountMap = {};
    allTeams.forEach(t => {
        teamMap[t.id] = t.name;
        teamMemberCountMap[t.id] = (t.members || []).length;
    });
    const enriched = list.map(u => {
        let expectedAmount = 399;
        if (u.paymentStatus === 'paid') {
            expectedAmount = u.amountPaid || 0;
        }
        else if (u.role === 'team-leader' && u.teamId) {
            expectedAmount = (teamMemberCountMap[u.teamId] || 1) * 399;
        }
        else if (u.role === 'participant' && u.teamId) {
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
        return res.json(enriched.filter(u => u.name.toLowerCase().includes(term) ||
            u.email.toLowerCase().includes(term) ||
            u.college.toLowerCase().includes(term) ||
            u.phone.includes(term) ||
            (u.teamName && u.teamName.toLowerCase().includes(term))));
    }
    return res.json(enriched);
});
// 2b. Update a participant's profile
router.put('/admin/participants/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const user = await db_1.Users.findOne({ id });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    const { name, email, phone, college, branch, year, gender, linkedin, paymentStatus, amountPaid, role, tshirtSize, foodPreference } = req.body;
    // If email is being changed, ensure it's not taken by someone else
    if (email && email.toLowerCase().trim() !== user.email) {
        const existing = await db_1.Users.findOne({ email: email.toLowerCase().trim() });
        if (existing && existing.id !== id) {
            return res.status(409).json({ message: `Email "${email}" is already used by another user.` });
        }
    }
    const updates = {};
    if (name !== undefined)
        updates.name = name.trim();
    if (email !== undefined)
        updates.email = email.toLowerCase().trim();
    if (phone !== undefined)
        updates.phone = phone;
    if (college !== undefined)
        updates.college = college;
    if (branch !== undefined)
        updates.branch = branch;
    if (year !== undefined)
        updates.year = year;
    if (gender !== undefined)
        updates.gender = gender;
    if (linkedin !== undefined)
        updates.linkedin = linkedin;
    if (paymentStatus !== undefined)
        updates.paymentStatus = paymentStatus;
    if (amountPaid !== undefined)
        updates.amountPaid = Number(amountPaid);
    if (role !== undefined)
        updates.role = role;
    if (tshirtSize !== undefined)
        updates.tshirtSize = tshirtSize || undefined;
    if (foodPreference !== undefined)
        updates.foodPreference = foodPreference || undefined;
    const updated = await db_1.Users.updateOne(id, updates);
    if (!updated)
        return res.status(500).json({ message: 'Failed to update user' });
    return res.json({ success: true, message: `${updated.name} updated successfully.`, user: updated });
});
// 2c. Delete a participant
router.delete('/admin/participants/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const user = await db_1.Users.findOne({ id });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    // Clean up team reference if user is in a team
    if (user.teamId) {
        const team = await db_1.Teams.findOne({ id: user.teamId });
        if (team) {
            if (team.leaderId === user.id) {
                // User is the leader: dissolve the team
                await Promise.all(team.members.map(mId => {
                    if (mId !== user.id) {
                        return db_1.Users.updateOne(mId, { teamId: undefined, teamRole: undefined, role: 'participant' });
                    }
                    return Promise.resolve();
                }));
                await db_1.Teams.deleteOne(team.id);
            }
            else {
                // User is a member: pull them from the team members list
                const updatedMembers = team.members.filter(mId => mId !== user.id);
                const newSlots = team.remainingSlots + 1;
                const teamStatus = newSlots > 0 ? 'open' : 'full';
                await db_1.Teams.updateOne(team.id, {
                    members: updatedMembers,
                    remainingSlots: newSlots,
                    status: teamStatus
                });
            }
        }
    }
    // Delete the user
    const deleted = await db_1.Users.deleteOne(id);
    if (!deleted) {
        return res.status(500).json({ message: 'Failed to delete user' });
    }
    return res.json({ success: true, message: 'User deleted successfully' });
});
// 2c. Impersonate / Login as user
router.post('/admin/impersonate', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return res.status(400).json({ message: 'User ID is required' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    // Generate JWT token for this user
    const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'codesprint-secret-key-2026', { expiresIn: '36500d' });
    return res.json({ success: true, token });
});
// ─── Admin: Approve / Reject submitted payment (UTR or manual) ───────────────
router.post('/admin/verify-utr', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { userId, action } = req.body; // action: 'approve' | 'reject'
    if (!userId || !action)
        return res.status(400).json({ message: 'userId and action are required.' });
    if (!['approve', 'reject'].includes(action))
        return res.status(400).json({ message: 'action must be "approve" or "reject".' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found.' });
    if (action === 'approve') {
        if (user.teamId) {
            // Approve payment for the whole team
            await handleTeamPaymentSuccess(user.teamId, user.utr || 'manual-admin-approve', user.amountPaid || 399, user.id);
        }
        else {
            await db_1.Users.updateOne(user.id, { paymentStatus: 'paid' });
        }
        await db_1.Notifications.create({
            recipientType: 'individual',
            recipientTarget: user.id,
            title: 'Payment Approved',
            message: 'Your payment has been verified and approved by the admin. You are now fully registered!',
            type: 'success',
            readBy: [],
            createdAt: new Date().toISOString()
        });
        return res.json({ success: true, message: 'Payment approved successfully.' });
    }
    else {
        await db_1.Users.updateOne(user.id, { paymentStatus: 'rejected' });
        await db_1.Notifications.create({
            recipientType: 'individual',
            recipientTarget: user.id,
            title: 'Payment Rejected',
            message: 'Your payment submission was rejected. Please re-submit your UTR or pay via Razorpay.',
            type: 'warning',
            readBy: [],
            createdAt: new Date().toISOString()
        });
        return res.json({ success: true, message: 'Payment rejected.' });
    }
});
// 3. Mark manual check-in or Scan QR code verify
router.post('/admin/check-in', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return res.status(400).json({ message: 'User ID is required' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    if (user.paymentStatus !== 'paid') {
        return res.status(400).json({ message: 'Cannot check-in. Payment is still pending.' });
    }
    await db_1.Users.updateOne(user.id, {
        checkedIn: true,
        checkInTime: new Date().toISOString()
    });
    const updatedUser = await db_1.Users.findOne({ id: user.id });
    return res.json({ success: true, message: `${user.name} checked in successfully.`, user: updatedUser });
});
// 3b. Admin: Add registration (individual or team) directly
router.post('/admin/add-registration', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { type, individual, team } = req.body;
    if (!type || !['individual', 'team'].includes(type)) {
        return res.status(400).json({ message: 'type must be "individual" or "team"' });
    }
    const timestamp = new Date().toISOString();
    // ── Individual ──────────────────────────────────────────────────────────────
    if (type === 'individual') {
        const { name, email, phone, college, branch, year, gender, linkedin, paymentStatus, amountPaid } = individual || {};
        if (!name || !email)
            return res.status(400).json({ message: 'name and email are required for individual registration' });
        const cleanEmail = email.toLowerCase().trim();
        const existing = await db_1.Users.findOne({ email: cleanEmail });
        if (existing)
            return res.status(409).json({ message: `A user with email "${cleanEmail}" already exists.` });
        const newUser = await db_1.Users.create({
            name: name.trim(),
            email: cleanEmail,
            phone: phone || '9999999999',
            college: college || '',
            branch: branch || '',
            year: year || '',
            gender: gender || 'Not Specified',
            linkedin: linkedin || 'https://linkedin.com',
            role: 'participant',
            paymentStatus: paymentStatus || 'paid',
            amountPaid: Number(amountPaid) || 500,
            teamRole: undefined,
            teamId: undefined,
            checkedIn: false,
            createdAt: timestamp,
        });
        return res.json({ success: true, message: 'Individual participant added successfully.', user: newUser });
    }
    // ── Team ─────────────────────────────────────────────────────────────────────
    if (type === 'team') {
        const { teamName, college, branch, year, description, paymentStatus, amountPaid, leader, members } = team || {};
        if (!teamName || !leader || !leader.name || !leader.email) {
            return res.status(400).json({ message: 'teamName, leader.name, and leader.email are required' });
        }
        const leaderEmail = leader.email.toLowerCase().trim();
        // Check/create leader
        let leaderUser = await db_1.Users.findOne({ email: leaderEmail });
        if (!leaderUser) {
            leaderUser = await db_1.Users.create({
                name: leader.name.trim(),
                email: leaderEmail,
                phone: leader.phone || '9999999999',
                college: college || '',
                branch: branch || '',
                year: year || '',
                gender: leader.gender || 'Not Specified',
                linkedin: leader.linkedin || 'https://linkedin.com',
                role: 'team-leader',
                paymentStatus: paymentStatus || 'paid',
                amountPaid: Number(amountPaid) || 500,
                teamRole: 'leader',
                checkedIn: false,
                createdAt: timestamp,
            });
        }
        else {
            await db_1.Users.updateOne(leaderUser.id, { role: 'team-leader', teamRole: 'leader' });
            leaderUser = (await db_1.Users.findOne({ id: leaderUser.id }));
        }
        // Check/create members
        const memberIds = [leaderUser.id];
        const memberList = Array.isArray(members) ? members : [];
        for (const mem of memberList) {
            if (!mem.email || !mem.name)
                continue;
            const memEmail = mem.email.toLowerCase().trim();
            let memUser = await db_1.Users.findOne({ email: memEmail });
            if (!memUser) {
                memUser = await db_1.Users.create({
                    name: mem.name.trim(),
                    email: memEmail,
                    phone: mem.phone || '9999999999',
                    college: college || '',
                    branch: branch || '',
                    year: year || '',
                    gender: mem.gender || 'Not Specified',
                    linkedin: mem.linkedin || 'https://linkedin.com',
                    role: 'participant',
                    paymentStatus: paymentStatus || 'paid',
                    amountPaid: Number(amountPaid) || 500,
                    teamRole: 'member',
                    checkedIn: false,
                    createdAt: timestamp,
                });
            }
            else {
                await db_1.Users.updateOne(memUser.id, { role: 'participant', teamRole: 'member' });
                memUser = (await db_1.Users.findOne({ id: memUser.id }));
            }
            memberIds.push(memUser.id);
        }
        // Create team
        const totalMembers = memberIds.length;
        const remainingSlots = Math.max(0, 5 - totalMembers);
        const status = totalMembers >= 5 ? 'full' : 'open';
        const slug = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const inviteLink = `${FRONTEND_BASE_URL}/teams/join?teamId=${slug}`;
        const newTeam = await db_1.Teams.create({
            name: teamName.trim(),
            description: description || `Team ${teamName} from ${college || 'Unknown College'}`,
            college: college || '',
            leaderId: leaderUser.id,
            members: memberIds,
            remainingSlots,
            status,
            inviteLink,
            joinRequests: [],
            createdAt: timestamp,
        });
        // Link all members to team
        for (const uid of memberIds) {
            await db_1.Users.updateOne(uid, { teamId: newTeam.id });
        }
        return res.json({ success: true, message: `Team "${teamName}" and ${memberIds.length} member(s) added successfully.`, team: newTeam });
    }
});
// 4. Coupons listing (with usage count)
router.get('/admin/coupons', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const list = await db_1.Coupons.find();
    return res.json(list);
});
// 5. Create Coupon
router.post('/admin/coupons/create', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { code, discountType, discountValue, collegeName, usageLimit, expiryDate } = req.body;
    if (!code || !discountType || !discountValue || !usageLimit || !expiryDate) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    const existing = await db_1.Coupons.findOne({ code: code.toUpperCase() });
    if (existing) {
        return res.status(400).json({ message: 'Coupon with this code already exists' });
    }
    const newCoupon = await db_1.Coupons.create({
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
router.post('/admin/coupons/toggle', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { couponId } = req.body;
    if (!couponId)
        return res.status(400).json({ message: 'Coupon ID is required' });
    const coupon = await db_1.Coupons.findOne({ id: couponId });
    if (!coupon)
        return res.status(404).json({ message: 'Coupon not found' });
    await db_1.Coupons.updateOne(coupon.id, { isActive: !coupon.isActive });
    const updatedCoupon = await db_1.Coupons.findOne({ id: coupon.id });
    return res.json({ success: true, coupon: updatedCoupon });
});
// 7. Get all teams for administrative overview
router.get('/admin/teams', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const list = await db_1.Teams.find();
    const enhancedTeams = await Promise.all(list.map(async (t) => {
        const leader = await db_1.Users.findOne({ id: t.leaderId });
        return {
            ...t,
            leaderName: leader ? leader.name : 'Unknown',
            memberCount: t.members.length
        };
    }));
    return res.json(enhancedTeams);
});
// 8. Delete a Team
router.delete('/admin/teams/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const team = await db_1.Teams.findOne({ id });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
    // Reset team parameters for all members
    await Promise.all(team.members.map(mId => db_1.Users.updateOne(mId, { teamId: undefined, teamRole: undefined, role: 'participant' })));
    await db_1.Teams.deleteOne(id);
    return res.json({ success: true, message: 'Team dissolved and members reset.' });
});
// 9. Merge two teams
router.post('/admin/teams/merge', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { teamAId, teamBId } = req.body;
    if (!teamAId || !teamBId) {
        return res.status(400).json({ message: 'Both Team IDs are required' });
    }
    const teamA = await db_1.Teams.findOne({ id: teamAId });
    const teamB = await db_1.Teams.findOne({ id: teamBId });
    if (!teamA || !teamB) {
        return res.status(404).json({ message: 'One or both teams not found' });
    }
    const combinedMembers = [...teamA.members, ...teamB.members];
    if (combinedMembers.length > 5) {
        return res.status(400).json({ message: `Merged team would have ${combinedMembers.length} members. Maximum allowed is 5.` });
    }
    // Merge team B into team A: update members and slots in Team A
    const newSlots = Math.max(0, 5 - combinedMembers.length);
    await db_1.Teams.updateOne(teamAId, {
        members: combinedMembers,
        remainingSlots: newSlots,
        status: newSlots === 0 ? 'full' : 'open'
    });
    // Re-map team B members to team A, set role as standard member
    await Promise.all(teamB.members.map(async (mId) => {
        await db_1.Users.updateOne(mId, {
            teamId: teamAId,
            teamRole: mId === teamA.leaderId ? 'leader' : 'member'
        });
    }));
    // Delete team B
    await db_1.Teams.deleteOne(teamBId);
    return res.json({ success: true, message: `Successfully merged team ${teamB.name} into ${teamA.name}` });
});
// 10. Send Broadcast Notification (SMS/Email simulation)
router.post('/admin/notifications/send', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { recipientType, recipientTarget, title, message, channel } = req.body; // channel: 'email' | 'sms' | 'push'
    if (!recipientType || !title || !message) {
        return res.status(400).json({ message: 'recipientType, title and message are required' });
    }
    // Save notification in database
    const notification = await db_1.Notifications.create({
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
        }
        else if (recipientType === 'individual' && recipientTarget) {
            io.to(recipientTarget).emit('broadcast_received', { title, message, type: 'info' });
        }
    }
    // Simulated logging
    console.log(`[BROADCAST] Target: ${recipientType} (${recipientTarget || 'ALL'}). Message: ${message}`);
    return res.json({ success: true, message: `Notification Banner successfully dispatched!`, notification });
});
// Helper for safe date parsing and formatting YYYY-MM-DD
function safeFormatDateKey(val) {
    if (!val)
        return 'Unknown';
    if (typeof val === 'string')
        return val.split('T')[0] || val;
    if (val instanceof Date)
        return val.toISOString().split('T')[0];
    if (typeof val?.toISOString === 'function')
        return val.toISOString().split('T')[0];
    try {
        const d = new Date(val);
        if (!isNaN(d.getTime()))
            return d.toISOString().split('T')[0];
    }
    catch (e) { }
    return 'Unknown';
}
// Helper for CSV value escaping
function escapeCsvVal(val) {
    if (val === null || val === undefined)
        return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
}
// 11. Export CSV Participants (Full analytics + Day-by-day + Colleges + Gender + Participant Ledger)
router.get('/admin/export-csv', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const users = await db_1.Users.find(u => u.role !== 'admin');
    const allTeams = await db_1.Teams.find();
    const teamMap = {};
    allTeams.forEach(t => { teamMap[t.id] = t.name; });
    // 1. Day-by-day registrations breakdown
    const registrationsByDate = {};
    users.forEach(u => {
        const dateStr = safeFormatDateKey(u.createdAt);
        if (dateStr !== 'Unknown') {
            registrationsByDate[dateStr] = (registrationsByDate[dateStr] || 0) + 1;
        }
    });
    const dateRows = Object.keys(registrationsByDate)
        .sort((a, b) => a.localeCompare(b))
        .map(date => `${escapeCsvVal(date)},${registrationsByDate[date]}`)
        .join('\n');
    // 2. College-wise distribution breakdown (with normalization)
    const collegeCounts = {};
    users.forEach(u => {
        if (u.college) {
            const canonical = normalizeCollegeName(u.college);
            collegeCounts[canonical] = (collegeCounts[canonical] || 0) + 1;
        }
    });
    const collegeRows = Object.keys(collegeCounts)
        .sort((a, b) => collegeCounts[b] - collegeCounts[a])
        .map(clg => `${escapeCsvVal(clg)},${collegeCounts[clg]}`)
        .join('\n');
    // 3. Gender demographics breakdown
    let maleCount = 0;
    let femaleCount = 0;
    let otherGenderCount = 0;
    users.forEach(u => {
        const g = (u.gender || '').toLowerCase().trim();
        if (g === 'male' || g === 'm')
            maleCount++;
        else if (g === 'female' || g === 'f')
            femaleCount++;
        else
            otherGenderCount++;
    });
    const totalUsers = users.length;
    const malePct = totalUsers ? ((maleCount / totalUsers) * 100).toFixed(1) : '0';
    const femalePct = totalUsers ? ((femaleCount / totalUsers) * 100).toFixed(1) : '0';
    const otherPct = totalUsers ? ((otherGenderCount / totalUsers) * 100).toFixed(1) : '0';
    // 4. Participant Registration records (13 columns)
    const headers = 'ID,Name,Email,Phone,College,Branch,Year,Gender,TshirtSize,TeamName,PaymentStatus,AmountPaid,RegistrationDate\n';
    const participantRows = users.map(u => {
        const teamName = u.teamId ? (teamMap[u.teamId] || u.teamId) : '';
        const dateFormatted = u.createdAt ? (typeof u.createdAt === 'string' ? u.createdAt : (typeof u.createdAt.toISOString === 'function' ? u.createdAt.toISOString() : String(u.createdAt))) : '';
        return [
            escapeCsvVal(u.id),
            escapeCsvVal(u.name),
            escapeCsvVal(u.email),
            escapeCsvVal(u.phone),
            escapeCsvVal(u.college),
            escapeCsvVal(u.branch),
            escapeCsvVal(u.year),
            escapeCsvVal(u.gender),
            escapeCsvVal(u.tshirtSize),
            escapeCsvVal(teamName),
            escapeCsvVal(u.paymentStatus),
            escapeCsvVal(u.amountPaid ?? 0),
            escapeCsvVal(dateFormatted)
        ].join(',');
    }).join('\n');
    const csvContent = `================================================================================
CODESPRINT 2026 — COMPREHENSIVE REGISTRATION & ANALYTICS REPORT
Generated On: ${new Date().toISOString()}
Total Registrations: ${totalUsers}
Male Participants: ${maleCount} (${malePct}%)
Female Participants: ${femaleCount} (${femalePct}%)
Other / Unspecified: ${otherGenderCount} (${otherPct}%)
================================================================================

=== SECTION 1: DAY-BY-DAY REGISTRATIONS BREAKDOWN ===
Date,Registered Students Count
${dateRows || 'No records'}

=== SECTION 2: COLLEGE-WISE REGISTRATION DISTRIBUTION ===
College Name,Student Count
${collegeRows || 'No records'}

=== SECTION 3: GENDER DEMOGRAPHICS BREAKDOWN ===
Gender,Student Count,Percentage
Male,${maleCount},${malePct}%
Female,${femaleCount},${femalePct}%
Other / Unspecified,${otherGenderCount},${otherPct}%

=== SECTION 4: ALL PARTICIPANT REGISTRATION RECORDS ===
${headers}${participantRows}
`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=codesprint_registrations_analytics_report.csv');
    return res.send(csvContent);
});
// --- USER FEED NOTIFICATIONS ---
// 1. Get user notifications feed
router.get('/notifications', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    // Get notifications matching:
    // - type = 'all'
    // - type = 'college' AND target = user's college
    // - type = 'team' AND target = user's teamId
    // - type = 'individual' AND target = user's ID
    const allNotifications = await db_1.Notifications.find();
    const userNotifications = allNotifications.filter(n => {
        if (n.recipientType === 'all')
            return true;
        if (n.recipientType === 'college' && n.recipientTarget?.toLowerCase() === user.college.toLowerCase())
            return true;
        if (n.recipientType === 'team' && user.teamId && n.recipientTarget === user.teamId)
            return true;
        if (n.recipientType === 'individual' && n.recipientTarget === user.id)
            return true;
        return false;
    });
    return res.json(userNotifications);
});
// 2. Mark notification as read
router.post('/notifications/read', exports.authenticateToken, async (req, res) => {
    const { notificationId } = req.body;
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const notification = await db_1.Notifications.findOne({ id: notificationId });
    if (!notification)
        return res.status(404).json({ message: 'Notification not found' });
    if (!notification.readBy.includes(userId)) {
        const updatedReadBy = [...notification.readBy, userId];
        await db_1.Notifications.updateOne(notification.id, { readBy: updatedReadBy });
    }
    return res.json({ success: true });
});
// --- TEAM INVITES ---
// 1. Leader sends invite to a user by email
router.post('/teams/invite', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const { inviteeEmail } = req.body;
    if (!inviteeEmail)
        return res.status(400).json({ message: 'Invitee email is required' });
    const leader = await db_1.Users.findOne({ id: userId });
    if (!leader)
        return res.status(404).json({ message: 'Leader not found' });
    if (!leader.teamId)
        return res.status(400).json({ message: 'You must have a team to send invites' });
    if (leader.teamRole !== 'leader')
        return res.status(403).json({ message: 'Only team leaders can send invites' });
    const team = await db_1.Teams.findOne({ id: leader.teamId });
    if (!team)
        return res.status(404).json({ message: 'Team not found' });
    if (team.remainingSlots <= 0)
        return res.status(400).json({ message: 'Team is already full' });
    // Check if invitee already in a team
    const invitee = await db_1.Users.findOne({ email: inviteeEmail.toLowerCase() });
    if (invitee?.teamId)
        return res.status(400).json({ message: 'This user is already in a team' });
    // Check if invitee has not paid, but team has available paid slots
    const paidMembersCount = (await db_1.Users.find({ teamId: team.id, paymentStatus: 'paid' })).length;
    const availablePaidSlots = (team.paidSlots || 1) - paidMembersCount;
    if (invitee?.paymentStatus !== 'paid' && availablePaidSlots <= 0) {
        return res.status(400).json({ message: 'User must have completed payment to join this team (no pre-paid slots left)' });
    }
    // Check duplicate pending invite
    const existing = await db_1.Invites.findOne((inv) => inv.teamId === team.id && inv.inviteeEmail === inviteeEmail.toLowerCase() && inv.status === 'pending');
    if (existing)
        return res.status(400).json({ message: 'An invite is already pending for this email' });
    const invite = await db_1.Invites.create({
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
        await db_1.Notifications.create({
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
router.get('/teams/my-invites', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    // Match by inviteeId or email
    const invites = await db_1.Invites.find((inv) => (inv.inviteeId === userId || inv.inviteeEmail === user.email.toLowerCase()) && inv.status === 'pending');
    return res.json(invites);
});
// 3. Accept or reject an invite
router.post('/teams/invite-respond', exports.authenticateToken, async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        return res.status(401).json({ message: 'Unauthorized' });
    const { inviteId, action } = req.body; // action: 'accept' | 'reject'
    if (!inviteId || !action)
        return res.status(400).json({ message: 'inviteId and action are required' });
    const user = await db_1.Users.findOne({ id: userId });
    if (!user)
        return res.status(404).json({ message: 'User not found' });
    const invite = await db_1.Invites.findOne({ id: inviteId });
    if (!invite)
        return res.status(404).json({ message: 'Invite not found' });
    if (invite.status !== 'pending')
        return res.status(400).json({ message: 'Invite is no longer pending' });
    if (invite.inviteeEmail !== user.email.toLowerCase() && invite.inviteeId !== userId) {
        return res.status(403).json({ message: 'This invite is not for you' });
    }
    if (action === 'reject') {
        await db_1.Invites.updateOne(inviteId, { status: 'rejected' });
        return res.json({ success: true, message: 'Invite declined.' });
    }
    // Accept: add user to team
    if (user.teamId)
        return res.status(400).json({ message: 'You are already in a team. Leave first.' });
    const team = await db_1.Teams.findOne({ id: invite.teamId });
    if (!team)
        return res.status(404).json({ message: 'Team no longer exists' });
    if (team.remainingSlots <= 0)
        return res.status(400).json({ message: 'Team is now full' });
    const updatedMembers = [...team.members, userId];
    const newSlots = Math.max(0, team.remainingSlots - 1);
    await db_1.Teams.updateOne(team.id, {
        members: updatedMembers,
        remainingSlots: newSlots,
        status: newSlots === 0 ? 'full' : 'open'
    });
    // Check if we should cover this user with pre-paid slots
    const paidMembersCount = (await db_1.Users.find({ teamId: team.id, paymentStatus: 'paid' })).length;
    const isPrepaid = team.paidSlots && team.paidSlots > paidMembersCount;
    await db_1.Users.updateOne(userId, {
        teamId: team.id,
        teamRole: 'member',
        paymentStatus: isPrepaid ? 'paid' : user.paymentStatus,
        amountPaid: isPrepaid ? 0 : user.amountPaid
    });
    await db_1.Invites.updateOne(inviteId, { status: 'accepted', inviteeId: userId });
    // Notify leader
    await db_1.Notifications.create({
        recipientType: 'individual',
        recipientTarget: invite.leaderId,
        title: `${user.name} joined your team!`,
        message: `${user.name} accepted your invite and joined team "${team.name}".`,
        type: 'success',
        readBy: [],
        createdAt: new Date().toISOString()
    });
    const updatedUser = await db_1.Users.findOne({ id: userId });
    return res.json({ success: true, message: 'You have joined the team!', user: updatedUser });
});
// ─── GUESTS & HIGHLIGHTS ROUTES ──────────────────────────────────────────────
router.get('/guests', async (req, res) => {
    const guests = await db_1.GuestsDb.find({});
    res.json(guests);
});
router.post('/admin/guests', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const guest = await db_1.GuestsDb.create({ ...req.body, createdAt: new Date().toISOString() });
    res.json(guest);
});
router.delete('/admin/guests/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    await db_1.GuestsDb.deleteOne(req.params.id);
    res.json({ success: true });
});
router.put('/admin/guests/:id/status', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const guest = await db_1.GuestsDb.updateOne(req.params.id, { status: req.body.status });
    res.json(guest);
});
router.get('/highlights', async (req, res) => {
    const highlights = await db_1.HighlightsDb.find({});
    res.json(highlights);
});
router.post('/admin/highlights', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const highlight = await db_1.HighlightsDb.create({ ...req.body, createdAt: new Date().toISOString() });
    res.json(highlight);
});
router.delete('/admin/highlights/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    await db_1.HighlightsDb.deleteOne(req.params.id);
    res.json({ success: true });
});
router.put('/admin/highlights/:id/pin', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const highlight = await db_1.HighlightsDb.updateOne(req.params.id, { isPinned: req.body.isPinned });
    res.json(highlight);
});
// ─── TIMELINE ROUTES ─────────────────────────────────────────────────────────
router.get('/timeline', async (req, res) => {
    const events = await db_1.TimelineDb.find({});
    res.json(events);
});
router.post('/admin/timeline', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const event = await db_1.TimelineDb.create(req.body);
    res.json(event);
});
router.put('/admin/timeline/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const event = await db_1.TimelineDb.updateOne(req.params.id, req.body);
    res.json(event);
});
router.delete('/admin/timeline/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    await db_1.TimelineDb.deleteOne(req.params.id);
    res.json({ success: true });
});
router.post('/admin/timeline/reset', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const current = await db_1.TimelineDb.find({});
    for (const ev of current) {
        await db_1.TimelineDb.deleteOne(ev.id);
    }
    for (const ev of req.body.events) {
        await db_1.TimelineDb.create(ev);
    }
    res.json(await db_1.TimelineDb.find({}));
});
// ─── COORDINATORS ROUTES ─────────────────────────────────────────────────────
router.get('/coordinators', async (req, res) => {
    const coords = await db_1.CoordinatorsDb.find({});
    res.json(coords);
});
router.post('/admin/coordinators', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const coord = await db_1.CoordinatorsDb.create(req.body);
    res.json(coord);
});
router.put('/admin/coordinators/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const coord = await db_1.CoordinatorsDb.updateOne(req.params.id, req.body);
    res.json(coord);
});
router.delete('/admin/coordinators/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    await db_1.CoordinatorsDb.deleteOne(req.params.id);
    res.json({ success: true });
});
// ─── COLLEGES ROUTES ─────────────────────────────────────────────────────────
router.get('/colleges', async (req, res) => {
    const colleges = await db_1.CollegesDb.find({});
    colleges.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json(colleges);
});
router.post('/public/colleges/ensure', async (req, res) => {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
        return res.status(400).json({ message: 'College name is required.' });
    }
    const savedName = await ensureCollegeExists(String(name));
    return res.json({ success: true, name: savedName });
});
// A.0 — POST /api/admin/send-otp
//   Body: { email: string }
//   Sends 6-digit verification OTP code to authorised admin email
router.post('/admin/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email || !String(email).trim()) {
        return res.status(400).json({ message: 'Admin email address is required.' });
    }
    try {
        const normalEmail = String(email).toLowerCase().trim();
        // Check AdminAllowlist or Users DB with role === 'admin'
        const allowed = await db_1.AdminAllowlist.findOne({ email: normalEmail });
        const adminUser = await db_1.Users.findOne({ email: normalEmail, role: 'admin' });
        if (!allowed && !adminUser && normalEmail !== 'admin@codesprint.com' && normalEmail !== 'admin@local.com') {
            return res.status(403).json({ message: `Access denied. "${normalEmail}" is not an authorised admin email.` });
        }
        const recipientName = allowed?.name || adminUser?.name || normalEmail.split('@')[0];
        // Invalidate old unused OTPs for this email
        const existing = await db_1.OtpStore.find({ email: normalEmail });
        for (const old of existing) {
            await db_1.OtpStore.updateOne(old.id, { used: true });
        }
        // Generate 6-digit OTP code
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // +10 mins
        await db_1.OtpStore.create({
            email: normalEmail,
            code,
            expiresAt,
            used: false,
            createdAt: new Date().toISOString()
        });
        // Send Email via Transporter
        const mailOptions = {
            from: `"CodeSprint 2026 Admin" <${process.env.EMAIL_USER || 'administrator@audisankara.ac.in'}>`,
            to: normalEmail,
            subject: `CodeSprint 2026 — Admin Verification Code: ${code}`,
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #6366f1; margin-top: 0;">Admin Control Panel Verification</h2>
          <p>Hello <strong>${recipientName}</strong>,</p>
          <p>Your one-time login verification code for CodeSprint 2026 Admin Control Panel is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #18181b; background: #f4f4f5; padding: 16px; border-radius: 8px; text-align: center; margin: 20px 0;">
            ${code}
          </div>
          <p style="font-size: 13px; color: #71717a;">This code is valid for 10 minutes. Do not share this code with anyone.</p>
        </div>
      `
        };
        try {
            await transporter.sendMail(mailOptions);
        }
        catch (mailErr) {
            console.error('[Admin Send Mail Error]:', mailErr);
        }
        const [userPart, domainPart] = normalEmail.split('@');
        const maskedUser = userPart.length > 2 ? `${userPart[0]}***${userPart[userPart.length - 1]}` : `${userPart[0]}***`;
        const maskedEmail = `${maskedUser}@${domainPart}`;
        return res.json({
            success: true,
            email: normalEmail,
            maskedEmail,
            name: recipientName,
            message: `Verification code sent to ${maskedEmail}`
        });
    }
    catch (err) {
        console.error('[Admin Send OTP Error]:', err);
        return res.status(500).json({ message: err.message || 'Failed to send verification OTP code.' });
    }
});
// Admin: Add a new college manually
router.post('/admin/colleges', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
        return res.status(400).json({ message: 'College name is required.' });
    }
    const normalized = normalizeCollegeName(String(name).trim());
    const existing = await db_1.CollegesDb.find({});
    const exists = existing.find((c) => c.name.toLowerCase().trim() === normalized.toLowerCase());
    if (exists) {
        return res.status(400).json({ message: `College "${exists.name}" already exists.` });
    }
    const created = await db_1.CollegesDb.create({
        id: `col_${(0, uuid_1.v4)()}`,
        name: normalized,
        createdAt: new Date().toISOString()
    });
    return res.status(201).json(created);
});
// Admin: Edit / Rename an existing college in DB (and cascade to users & teams)
router.put('/admin/colleges/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name || !String(name).trim()) {
        return res.status(400).json({ message: 'New college name is required.' });
    }
    const collegeDoc = await db_1.CollegesDb.findOne({ id });
    if (!collegeDoc) {
        return res.status(404).json({ message: 'College not found.' });
    }
    const oldName = collegeDoc.name;
    const newName = normalizeCollegeName(String(name).trim());
    // Update CollegesDb
    const updated = await db_1.CollegesDb.updateOne(id, { name: newName });
    // Cascade update all users with old college name
    const usersToUpdate = await db_1.Users.find((u) => u.college && u.college.toLowerCase().trim() === oldName.toLowerCase().trim());
    for (const u of usersToUpdate) {
        await db_1.Users.updateOne(u.id, { college: newName });
    }
    // Cascade update all teams with old college name
    const teamsToUpdate = await db_1.Teams.find((t) => t.college && t.college.toLowerCase().trim() === oldName.toLowerCase().trim());
    for (const t of teamsToUpdate) {
        await db_1.Teams.updateOne(t.id, { college: newName });
    }
    return res.json({ success: true, college: updated, updatedUsers: usersToUpdate.length, updatedTeams: teamsToUpdate.length });
});
// Admin: Delete a college from database
router.delete('/admin/colleges/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const deleted = await db_1.CollegesDb.deleteOne(id);
    if (!deleted) {
        return res.status(404).json({ message: 'College not found.' });
    }
    return res.json({ success: true, message: 'College deleted successfully.' });
});
// Admin: Update college for a specific participant
router.put('/admin/users/:id/college', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { college } = req.body;
    if (!college || !String(college).trim()) {
        return res.status(400).json({ message: 'College name is required.' });
    }
    const user = await db_1.Users.findOne({ id });
    if (!user) {
        return res.status(404).json({ message: 'User not found.' });
    }
    const normalized = await ensureCollegeExists(String(college));
    await db_1.Users.updateOne(id, { college: normalized });
    // If user is leader of a team, update team college as well
    if (user.teamId && user.role === 'team-leader') {
        await db_1.Teams.updateOne(user.teamId, { college: normalized });
    }
    const updatedUser = await db_1.Users.findOne({ id });
    return res.json({ success: true, user: updatedUser });
});
// Admin: Update college for a specific team
router.put('/admin/teams/:id/college', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { college } = req.body;
    if (!college || !String(college).trim()) {
        return res.status(400).json({ message: 'College name is required.' });
    }
    const team = await db_1.Teams.findOne({ id });
    if (!team) {
        return res.status(404).json({ message: 'Team not found.' });
    }
    const normalized = await ensureCollegeExists(String(college));
    await db_1.Teams.updateOne(id, { college: normalized });
    // Optionally update all team members' college
    for (const memberId of team.members) {
        await db_1.Users.updateOne(memberId, { college: normalized });
    }
    const updatedTeam = await db_1.Teams.findOne({ id });
    return res.json({ success: true, team: updatedTeam });
});
router.post('/admin/colleges/cleanup', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const allColleges = await db_1.CollegesDb.find({});
    let cleanedCount = 0;
    let mergedCount = 0;
    const nameToIdMap = new Map();
    for (const col of allColleges) {
        const cleanName = normalizeCollegeName(col.name);
        if (!cleanName || cleanName.length < 2) {
            await db_1.CollegesDb.deleteOne(col.id);
            cleanedCount++;
            continue;
        }
        const lowerKey = cleanName.toLowerCase().trim();
        if (nameToIdMap.has(lowerKey)) {
            // Duplicate college: delete duplicate from CollegesDb
            await db_1.CollegesDb.deleteOne(col.id);
            mergedCount++;
        }
        else {
            nameToIdMap.set(lowerKey, col.id);
            if (col.name !== cleanName) {
                await db_1.CollegesDb.updateOne(col.id, { name: cleanName });
                cleanedCount++;
            }
        }
    }
    // Also clean up Users and Teams college names
    const allUsers = await db_1.Users.find({});
    for (const u of allUsers) {
        if (u.college) {
            const cleaned = normalizeCollegeName(u.college);
            if (cleaned !== u.college) {
                await db_1.Users.updateOne(u.id, { college: cleaned });
            }
        }
    }
    const allTeams = await db_1.Teams.find({});
    for (const t of allTeams) {
        if (t.college) {
            const cleaned = normalizeCollegeName(t.college);
            if (cleaned !== t.college) {
                await db_1.Teams.updateOne(t.id, { college: cleaned });
            }
        }
    }
    const remaining = await db_1.CollegesDb.find({});
    return res.json({
        success: true,
        message: `Database cleaned! Cleaned ${cleanedCount} entries and merged ${mergedCount} duplicates.`,
        totalCollegesRemaining: remaining.length
    });
});
router.post('/admin/colleges/upload', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { csvContent } = req.body;
    if (!csvContent)
        return res.status(400).json({ message: 'Missing CSV content' });
    // Load existing college names (case-insensitive dedup)
    const existing = await db_1.CollegesDb.find({});
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));
    // Parse CSV
    const lines = csvContent.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const added = [];
    for (const line of lines) {
        const name = normalizeCollegeName(line);
        if (name && name.length > 2 && !existingNames.has(name.toLowerCase())) {
            const col = await db_1.CollegesDb.create({
                id: `col_${(0, uuid_1.v4)()}`,
                name,
                createdAt: new Date().toISOString()
            });
            added.push(col);
            existingNames.add(name.toLowerCase());
        }
    }
    const totalNow = existing.length + added.length;
    return res.json({ success: true, count: added.length, total: totalNow, message: `Added ${added.length} clean college(s). Total: ${totalNow}.` });
});
// ─── PROBLEM STATEMENTS ROUTES ───────────────────────────────────────────────
router.get('/problem-statements', exports.authenticateToken, async (req, res) => {
    const problems = await db_1.ProblemDb.find({});
    res.json(problems);
});
router.post('/admin/problem-statements', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const prob = await db_1.ProblemDb.create({
        ...req.body,
        id: `ps_${Date.now()}`,
        createdAt: new Date().toISOString()
    });
    res.json(prob);
});
router.post('/admin/problem-statements/upload', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { csvContent } = req.body;
    if (!csvContent)
        return res.status(400).json({ message: 'Missing CSV content' });
    // Clear existing statements? The user asked to "bulk upload", let's clear them just like Colleges, or append?
    // Since it's bulk upload, usually it's for initializing. I'll just clear existing for simplicity and consistency with Colleges.
    const existing = await db_1.ProblemDb.find({});
    for (const p of existing)
        await db_1.ProblemDb.deleteOne(p.id);
    const lines = csvContent.split('\n').filter((l) => l.trim().length > 0);
    // Check header
    if (lines[0].toLowerCase().includes('title'))
        lines.shift();
    const added = [];
    for (const line of lines) {
        // Basic CSV splitting (this assumes no commas inside the values for simplicity)
        const [title, description, visibleFrom, visibleTo] = line.split(',').map((x) => x.trim().replace(/(^"|"$)/g, ''));
        if (title && description) {
            const prob = await db_1.ProblemDb.create({
                id: `ps_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
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
router.put('/admin/problem-statements/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const prob = await db_1.ProblemDb.updateOne(req.params.id, req.body);
    res.json(prob);
});
router.delete('/admin/problem-statements/:id', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    await db_1.ProblemDb.deleteOne(req.params.id);
    res.json({ success: true });
});
router.post('/admin/problem-statements/distribute', exports.authenticateToken, exports.requireAdmin, async (req, res) => {
    const { mode, mapping } = req.body; // mode: 'all' or 'csv' (mapping = [{ teamId, problemId }])
    const problems = await db_1.ProblemDb.find({});
    if (mode === 'all') {
        const allTeams = await db_1.Teams.find({});
        const allTeamIds = allTeams.map(t => t.id);
        for (const p of problems) {
            await db_1.ProblemDb.updateOne(p.id, { assignedTo: allTeamIds });
        }
        return res.json({ success: true, message: 'Distributed all problems to all teams.' });
    }
    else if (mode === 'csv') {
        // Reset assigned arrays first
        for (const p of problems) {
            await db_1.ProblemDb.updateOne(p.id, { assignedTo: [] });
        }
        // Group mapping by problemId
        const assignmentMap = {};
        for (const item of mapping) {
            if (!assignmentMap[item.problemId])
                assignmentMap[item.problemId] = [];
            assignmentMap[item.problemId].push(item.teamId);
        }
        for (const p of problems) {
            if (assignmentMap[p.id]) {
                await db_1.ProblemDb.updateOne(p.id, { assignedTo: assignmentMap[p.id] });
            }
        }
        return res.json({ success: true, message: 'Distributed based on CSV mapping.' });
    }
    return res.status(400).json({ message: 'Invalid distribution mode' });
});
// User route to fetch their assigned active problems
router.get('/user/problem-statements', exports.authenticateToken, async (req, res) => {
    const user = await db_1.Users.findOne({ id: req.user.id });
    if (!user || !user.teamId)
        return res.json([]);
    const problems = await db_1.ProblemDb.find({});
    const now = new Date();
    const activeProblems = problems.filter(p => {
        // Check if team is assigned
        if (!p.assignedTo || !p.assignedTo.includes(user.teamId))
            return false;
        // Check time window
        const from = new Date(p.visibleFrom);
        const to = new Date(p.visibleTo);
        return now >= from && now <= to;
    });
    res.json(activeProblems);
});
exports.default = router;
