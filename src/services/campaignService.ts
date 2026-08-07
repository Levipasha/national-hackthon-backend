import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Users, Notifications } from '../config/db';

dotenv.config();

const FRONTEND_BASE_URL = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',')[0].trim() : 'http://localhost:3000';

const transporter = nodemailer.createTransport({
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

// In-memory log of campaign emails sent in this session to prevent double-sending
const sentCampaignLogs: { [key: string]: boolean } = {};
let mail1ScheduledTimer: NodeJS.Timeout | null = null;
let mail2ScheduledTimer: NodeJS.Timeout | null = null;

export interface RecipientMailLog {
  userId: string;
  name: string;
  email: string;
  college: string;
  status: 'sent' | 'failed' | 'pending';
  sentAt?: string;
  error?: string;
}

const recipientMailLogs: Record<string, RecipientMailLog> = {};

export async function getCampaignRecipientsList(): Promise<RecipientMailLog[]> {
  const allUsers = await Users.find(u => u.role !== 'admin' && Boolean(u.email));
  return allUsers.map(user => {
    const log = recipientMailLogs[user.id];
    const isSentInSession = sentCampaignLogs[`mail2_${user.id}_${user.email}`];
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      college: user.college || 'N/A',
      status: log?.status || (isSentInSession ? 'sent' : 'pending'),
      sentAt: log?.sentAt || (isSentInSession ? (campaignStatus.mail2LastRun || undefined) : undefined),
      error: log?.error
    };
  });
}

const MAX_DAILY_BULK_RUNS = 2;
const dailyRunsHistory: string[] = [];

export function getTodayBulkRunsCount(): number {
  const todayStr = new Date().toISOString().split('T')[0];
  return dailyRunsHistory.filter(ts => ts.startsWith(todayStr)).length;
}

export let campaignStatus = {
  mail1ScheduledTime: '2026-08-03T09:00:00+05:30',
  mail2ScheduledTime: '2026-08-03T09:10:00+05:30',
  mail1Sent: false,
  mail2Sent: false,
  mail1SentCount: 0,
  mail2SentCount: 0,
  mail1LastRun: null as string | null,
  mail2LastRun: null as string | null,

  // Live broadcast campaign status tracking
  inProgress: false,
  processedCount: 0,
  totalCount: 0,
  sentCount: 0,
  failedCount: 0,
  lastError: null as string | null,
  startedAt: null as string | null,
  completedAt: null as string | null,
};

export function getCampaignStatusWithDailyLimit() {
  const runsToday = getTodayBulkRunsCount();
  return {
    ...campaignStatus,
    runsToday,
    maxDailyRuns: MAX_DAILY_BULK_RUNS,
    canRunToday: runsToday < MAX_DAILY_BULK_RUNS
  };
}

/**
 * Stage 1 Email Template: Registration Confirmation
 */
export function getRegistrationWelcomeEmailTemplate(userName: string): { subject: string; html: string } {
  const dashboardLink = `${FRONTEND_BASE_URL}/dashboard`;
  return {
    subject: 'Registration Confirmed - Welcome to CodeSprint 2026!',
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 600px; margin: auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 20px; background-color: #ffffff; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-b: 1px solid #f1f5f9;">
          <h1 style="color: #6d28d9; margin: 0; font-size: 28px; font-weight: 800; tracking-tight: -0.5px;">CodeSprint 2026</h1>
          <p style="color: #64748b; font-size: 11px; margin-top: 4px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Audisankara Deemed to be University • Gudur</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-left: 5px solid #22c55e; padding: 18px; border-radius: 12px; margin-bottom: 24px;">
          <h2 style="color: #15803d; margin: 0 0 6px 0; font-size: 17px; font-weight: 800;">🎉 Registration Successfully Confirmed!</h2>
          <p style="color: #166534; font-size: 14px; margin: 0; line-height: 1.5; font-weight: 600;">
            Dear <strong>${userName}</strong>,<br/>
            Congratulations! Your registration for CodeSprint 2026 National Level Hackathon is officially confirmed.
          </p>
        </div>

        <div style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 28px;">
          <p style="margin-bottom: 12px;">We are excited to welcome you to the Audisankara campus for an intense 8-hour hacking experience.</p>
          
          <p style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 10px; font-size: 13px; color: #475569;">
            👉 <strong>Your Dashboard is Active:</strong> Access your entry pass, team management, and announcements on your participant dashboard.
          </p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${dashboardLink}" style="background: linear-gradient(135deg, #6d28d9 0%, #4c1d95 100%); color: #ffffff; padding: 15px 32px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(109, 40, 217, 0.35);">
            🚀 Open Participant Dashboard
          </a>
        </div>

        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 28px 0;" />
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
          CodeSprint 2026 Organizing Committee • Audisankara Deemed to be University, Gudur, AP, India
        </p>
      </div>
    `
  };
}

/**
 * Stage 2 Email Template: Hackathon Guidelines PDF Release
 */
export function getGuidelinesEmailTemplate(userName: string): { subject: string; html: string } {
  const dashboardLink = `${FRONTEND_BASE_URL}/dashboard`;
  return {
    subject: '[Important] CodeSprint 2026 Hackathon Guidelines & Rules Released',
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 600px; margin: auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 20px; background-color: #ffffff; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-b: 1px solid #f1f5f9;">
          <h1 style="color: #6d28d9; margin: 0; font-size: 28px; font-weight: 800; tracking-tight: -0.5px;">CodeSprint 2026</h1>
          <p style="color: #64748b; font-size: 11px; margin-top: 4px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Audisankara Deemed to be University • Gudur</p>
        </div>
        
        <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-left: 5px solid #f59e0b; padding: 18px; border-radius: 12px; margin-bottom: 24px;">
          <h2 style="color: #92400e; margin: 0 0 6px 0; font-size: 17px; font-weight: 800;">📢 Official Guidelines PDF Released</h2>
          <p style="color: #78350f; font-size: 14px; margin: 0; line-height: 1.5; font-weight: 600;">
            Dear <strong>${userName}</strong>,<br/>
            The official Hackathon Guidelines and Rules document for CodeSprint 2026 is now live on your participant dashboard.
          </p>
        </div>

        <div style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 28px;">
          <p style="margin-bottom: 12px;">It is <strong>critically important that every registered participant</strong> reads the guidelines document thoroughly to gain complete clarity on:</p>
          
          <ul style="padding-left: 20px; color: #475569; margin: 0 0 16px 0; line-height: 1.7;">
            <li><strong>Check-in Desk & Event Schedule:</strong> Entry requirements at KVT Hall opening at 09:00 AM.</li>
            <li><strong>Hackathon Rules & Evaluation:</strong> Rounds, judging criteria, and submission deadlines.</li>
            <li><strong>Allowed Tech Stack & AI Tools:</strong> Open-source libraries and GenAI guidelines.</li>
            <li><strong>Event Inclusions:</strong> Official T-Shirts, Working Lunch, Wi-Fi passes, & Certificates.</li>
          </ul>
          
          <p style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 10px; font-size: 13px; color: #475569;">
            👉 <strong>How to download:</strong> Log in to your CodeSprint Dashboard and click the bright <strong>"Download Guidelines PDF"</strong> button.
          </p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${dashboardLink}" style="background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color: #ffffff; padding: 15px 32px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.35);">
            📄 Go to Dashboard & Download Guidelines
          </a>
        </div>

        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 28px 0;" />
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
          CodeSprint 2026 Organizing Committee • Audisankara Deemed to be University, Gudur, AP, India
        </p>
      </div>
    `
  };
}

/**
 * Stage 3 Email Template: WhatsApp Community Group Invitation
 */
export function getWhatsAppEmailTemplate(userName: string): { subject: string; html: string } {
  const whatsappGroupUrl = 'https://chat.whatsapp.com/IA1BaLQ7gpu46RrbEz7mN7';
  return {
    subject: '[Action Required] Join Official CodeSprint 2026 WhatsApp Group',
    html: `
      <div style="font-family: 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 600px; margin: auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 20px; background-color: #ffffff; color: #1e293b;">
        <div style="text-align: center; margin-bottom: 24px; padding-bottom: 16px; border-b: 1px solid #f1f5f9;">
          <h1 style="color: #059669; margin: 0; font-size: 28px; font-weight: 800; tracking-tight: -0.5px;">CodeSprint 2026</h1>
          <p style="color: #64748b; font-size: 11px; margin-top: 4px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Participant WhatsApp Community</p>
        </div>

        <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-left: 5px solid #10b981; padding: 18px; border-radius: 12px; margin-bottom: 24px;">
          <h2 style="color: #065f46; margin: 0 0 6px 0; font-size: 17px; font-weight: 800;">💬 Join Official WhatsApp Group</h2>
          <p style="color: #047857; font-size: 14px; margin: 0; line-height: 1.5; font-weight: 600;">
            Dear <strong>${userName}</strong>,<br/>
            You are officially invited to join the CodeSprint 2026 Participant WhatsApp Community!
          </p>
        </div>

        <div style="color: #334155; font-size: 14px; line-height: 1.6; margin-bottom: 28px;">
          <p style="margin-bottom: 12px;">By joining the official WhatsApp group, you will get direct access to:</p>
          <ul style="padding-left: 20px; color: #475569; margin: 0 0 16px 0; line-height: 1.7;">
            <li><strong>Instant Event Announcements:</strong> Real-time alerts on schedules, problem statement unlocks, and venue updates.</li>
            <li><strong>Team Networking:</strong> Connect with fellow hackers, find teammates, and coordinate with leaders.</li>
            <li><strong>Mentor Support:</strong> Directly communicate with technical faculty & industry coordinators.</li>
          </ul>
          
          <p style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px 16px; border-radius: 10px; font-size: 13px; color: #475569;">
            👉 <strong>Join directly via link:</strong> Click the button below to enter the official WhatsApp group.
          </p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${whatsappGroupUrl}" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; padding: 15px 32px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 15px; display: inline-block; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);">
            💬 Join Official WhatsApp Group Now
          </a>
        </div>

        <p style="text-align: center; font-size: 12px; color: #64748b; margin-top: 16px;">
          Group URL: <a href="${whatsappGroupUrl}" style="color: #059669; font-weight: 700; text-decoration: underline;">${whatsappGroupUrl}</a>
        </p>

        <hr style="border: 0; border-top: 1px solid #f1f5f9; margin: 28px 0;" />
        <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
          CodeSprint 2026 Organizing Committee • Audisankara Deemed to be University, Gudur, AP, India
        </p>
      </div>
    `
  };
}

/**
 * Schedules automated 3-stage email drip sequence for newly registered users:
 * 1. Stage 1 (0 min - Immediate): Registration Confirmation Email
 * 2. Stage 2 (+2 min gap): Hackathon Guidelines PDF Release Email
 * 3. Stage 3 (+10 min gap after Stage 2 / +12 min total): Official WhatsApp Group Link Email
 */
export async function scheduleNewUserWelcomeSequence(user: { id?: string; name: string; email: string }) {
  if (!user || !user.email) return;

  const logPrefix = `[New User Email Drip - ${user.email}]`;

  // ── Stage 1: Immediate Registration Confirmation (0 min) ──
  try {
    const template1 = getRegistrationWelcomeEmailTemplate(user.name);
    await transporter.sendMail({
      from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
      to: user.email,
      subject: template1.subject,
      html: template1.html
    });
    console.log(`${logPrefix} Stage 1 (Registration Confirmation) sent immediately.`);
  } catch (err) {
    console.error(`${logPrefix} Stage 1 Error:`, err);
  }

  // ── Stage 2: Guidelines PDF Release (+2 min) ──
  setTimeout(async () => {
    try {
      const template2 = getGuidelinesEmailTemplate(user.name);
      await transporter.sendMail({
        from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
        to: user.email,
        subject: template2.subject,
        html: template2.html
      });
      console.log(`${logPrefix} Stage 2 (Guidelines PDF) sent after 2 min delay.`);
    } catch (err) {
      console.error(`${logPrefix} Stage 2 Error:`, err);
    }
  }, 2 * 60 * 1000); // 2 minutes

  // ── Stage 3: WhatsApp Group Link (+12 min total / 10 min after Stage 2) ──
  setTimeout(async () => {
    try {
      const template3 = getWhatsAppEmailTemplate(user.name);
      await transporter.sendMail({
        from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
        to: user.email,
        subject: template3.subject,
        html: template3.html
      });
      console.log(`${logPrefix} Stage 3 (WhatsApp Group) sent after 10 min gap (12 min total).`);
    } catch (err) {
      console.error(`${logPrefix} Stage 3 Error:`, err);
    }
  }, 12 * 60 * 1000); // 12 minutes total (2 min + 10 min)
}

/**
 * Executes Broadcast Campaign Mail 1 (Guidelines PDF) to all existing registered participants
 */
export async function sendCampaignMail1(): Promise<{ sentCount: number; failedCount: number }> {
  const allUsers = await Users.find(u => u.role !== 'admin' && Boolean(u.email));
  let sentCount = 0;
  let failedCount = 0;

  console.log(`[Campaign Mail 1 - Guidelines] Starting broadcast to ${allUsers.length} registered participants...`);

  for (const user of allUsers) {
    const logKey = `mail1_${user.id}_${user.email}`;
    if (sentCampaignLogs[logKey]) continue;

    try {
      const template = getGuidelinesEmailTemplate(user.name);
      await transporter.sendMail({
        from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
        to: user.email,
        subject: template.subject,
        html: template.html
      });
      sentCampaignLogs[logKey] = true;
      sentCount++;
      // Wait 1 second between email sends to prevent hitting SMTP rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`[Campaign Mail 1 Error] Failed to send to ${user.email}:`, err);
      failedCount++;
    }
  }

  campaignStatus.mail1Sent = true;
  campaignStatus.mail1SentCount = sentCount;
  campaignStatus.mail1LastRun = new Date().toISOString();

  console.log(`[Campaign Mail 1 Completed] Sent: ${sentCount}, Failed: ${failedCount}`);
  return { sentCount, failedCount };
}

/**
 * Executes Broadcast Campaign Mail 2 (WhatsApp Group Link) to all existing registered participants
 */
export async function sendCampaignMail2(force: boolean = false): Promise<{ success: boolean; message: string; campaignStatus: any }> {
  if (campaignStatus.inProgress) {
    return {
      success: false,
      message: `Campaign is already in progress (${campaignStatus.sentCount}/${campaignStatus.totalCount} sent).`,
      campaignStatus: getCampaignStatusWithDailyLimit()
    };
  }

  const runsToday = getTodayBulkRunsCount();
  if (runsToday >= MAX_DAILY_BULK_RUNS) {
    return {
      success: false,
      message: `Daily limit reached! Bulk emails can only be sent up to ${MAX_DAILY_BULK_RUNS} times per day (${runsToday}/${MAX_DAILY_BULK_RUNS} dispatches used today). Please try again tomorrow.`,
      campaignStatus: getCampaignStatusWithDailyLimit()
    };
  }

  // Record this run in history
  dailyRunsHistory.push(new Date().toISOString());

  const allUsers = await Users.find(u => u.role !== 'admin' && Boolean(u.email));

  if (force) {
    Object.keys(sentCampaignLogs).forEach(k => {
      if (k.startsWith('mail2_')) delete sentCampaignLogs[k];
    });
  }

  campaignStatus.inProgress = true;
  campaignStatus.startedAt = new Date().toISOString();
  campaignStatus.completedAt = null;
  campaignStatus.lastError = null;
  campaignStatus.totalCount = allUsers.length;
  campaignStatus.processedCount = 0;
  campaignStatus.sentCount = 0;
  campaignStatus.failedCount = 0;

  console.log(`[Campaign Mail 2 - WhatsApp Group] Starting background broadcast to ${allUsers.length} registered participants...`);

  // Run sending sequence asynchronously in background
  (async () => {
    try {
      for (const user of allUsers) {
        const logKey = `mail2_${user.id}_${user.email}`;
        if (!force && sentCampaignLogs[logKey]) {
          campaignStatus.processedCount++;
          campaignStatus.sentCount++;
          continue;
        }

        try {
          const template = getWhatsAppEmailTemplate(user.name);
          await transporter.sendMail({
            from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
            to: user.email,
            subject: template.subject,
            html: template.html
          });
          sentCampaignLogs[logKey] = true;
          campaignStatus.sentCount++;
          recipientMailLogs[user.id] = {
            userId: user.id,
            name: user.name,
            email: user.email,
            college: user.college || 'N/A',
            status: 'sent',
            sentAt: new Date().toISOString()
          };
        } catch (err: any) {
          console.error(`[Campaign Mail 2 Error] Failed to send to ${user.email}:`, err);
          campaignStatus.failedCount++;
          campaignStatus.lastError = err?.message || 'SMTP delivery failure';
          recipientMailLogs[user.id] = {
            userId: user.id,
            name: user.name,
            email: user.email,
            college: user.college || 'N/A',
            status: 'failed',
            error: err?.message || 'SMTP delivery failure'
          };
        } finally {
          campaignStatus.processedCount++;
        }

        // Wait 1 second between email sends to respect SMTP rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      campaignStatus.mail2Sent = true;
      campaignStatus.mail2SentCount = campaignStatus.sentCount;
      campaignStatus.mail2LastRun = new Date().toISOString();
      campaignStatus.completedAt = new Date().toISOString();
      console.log(`[Campaign Mail 2 Completed] Sent: ${campaignStatus.sentCount}, Failed: ${campaignStatus.failedCount}`);
    } catch (err: any) {
      console.error('[Campaign Mail 2 Fatal Error]:', err);
      campaignStatus.lastError = err?.message || 'Fatal execution error';
    } finally {
      campaignStatus.inProgress = false;
    }
  })();

  return {
    success: true,
    message: `Broadcast email campaign started for ${allUsers.length} registered participants.`,
    campaignStatus
  };
}

/**
 * Schedule automated campaign for 03/08/2026 (09:00 AM Mail 1, 09:10 AM Mail 2)
 */
export function scheduleAug3Campaign() {
  if (mail1ScheduledTimer) clearTimeout(mail1ScheduledTimer);
  if (mail2ScheduledTimer) clearTimeout(mail2ScheduledTimer);

  const now = new Date();
  
  // Target Mail 1: 03/08/2026 09:00:00 AM IST (UTC+05:30)
  const targetMail1 = new Date('2026-08-03T09:00:00+05:30');
  
  // Target Mail 2: 03/08/2026 09:10:00 AM IST (UTC+05:30)
  const targetMail2 = new Date('2026-08-03T09:10:00+05:30');

  const expiryCutoff = new Date(targetMail2.getTime() + 15 * 60 * 1000);

  // If campaign date has already passed (e.g. today is past August 3, 2026), log status and exit cleanly
  if (now > expiryCutoff) {
    console.log('[Campaign Scheduler] Scheduled campaign date (03/08/2026) has already passed. Standby mode.');
    return;
  }

  const delayMail1 = targetMail1.getTime() - now.getTime();
  const delayMail2 = targetMail2.getTime() - now.getTime();

  console.log(`[Campaign Scheduler] Initialized for 03/08/2026.`);
  if (delayMail1 > 0) {
    console.log(`  - Mail 1 (Guidelines PDF) scheduled at: 09:00 AM IST (in ${Math.round(delayMail1 / 1000 / 60)} minutes)`);
    mail1ScheduledTimer = setTimeout(async () => {
      await sendCampaignMail1();
    }, delayMail1);
  }

  if (delayMail2 > 0) {
    console.log(`  - Mail 2 (WhatsApp Group) scheduled at: 09:10 AM IST (in ${Math.round(delayMail2 / 1000 / 60)} minutes)`);
    mail2ScheduledTimer = setTimeout(async () => {
      await sendCampaignMail2();
    }, delayMail2);
  }

  // Backup interval checker (clears itself when target window passes)
  const backupInterval = setInterval(async () => {
    const currentTime = new Date();
    if (currentTime > expiryCutoff) {
      clearInterval(backupInterval);
      return;
    }
    
    // Check Mail 1 window (between 09:00 AM and 09:05 AM)
    if (!campaignStatus.mail1Sent && currentTime >= targetMail1 && currentTime < new Date(targetMail1.getTime() + 10 * 60 * 1000)) {
      console.log(`[Campaign Backup Scheduler] Triggering Mail 1...`);
      await sendCampaignMail1();
    }

    // Check Mail 2 window (between 09:10 AM and 09:15 AM)
    if (!campaignStatus.mail2Sent && currentTime >= targetMail2 && currentTime < new Date(targetMail2.getTime() + 10 * 60 * 1000)) {
      console.log(`[Campaign Backup Scheduler] Triggering Mail 2...`);
      await sendCampaignMail2();
    }
  }, 30000);
}
