require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const user = { name: "Abbu Pasha" };

async function sendTest() {
  try {
    await transporter.sendMail({
      from: '"CodeSprint 2026" <administrator@audisankara.ac.in>',
      to: "abbupasha61@gmail.com",
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
    console.log("Test email sent!");
  } catch (err) {
    console.error(err);
  }
}

sendTest();
