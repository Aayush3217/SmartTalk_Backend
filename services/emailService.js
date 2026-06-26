// const nodemailer = require('nodemailer')
// const dotenv = require('dotenv')
// dotenv.config();

// const transporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth:{
//         user : process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS
//     }
// }); 

// transporter.verify((error, success) => {
//     if(error){
//         console.error('Gmail services connection failed')
//     }else{
//         console.log('Gmail configured properly and ready to send email')
//     }
// });

// const sendOtpToEmail = async (email, otp) => {
//   const html = `
//     <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
//       <h2 style="color: #075e54;">🔐 WhatsApp Web Verification</h2>
      
//       <p>Hi there,</p>
      
//       <p>Your one-time password (OTP) to verify your WhatsApp Web account is:</p>
      
//       <h1 style="background: #e0f7fa; color: #000; padding: 10px 20px; display: inline-block; border-radius: 5px; letter-spacing: 2px;">
//         ${otp}
//       </h1>

//       <p><strong>This OTP is valid for the next 5 minutes.</strong> Please do not share this code with anyone.</p>

//       <p>If you didn’t request this OTP, please ignore this email.</p>

//       <p style="margin-top: 20px;">Thanks & Regards,<br/>WhatsApp Web Security Team</p>

//       <hr style="margin: 30px 0;" />

//       <small style="color: #777;">This is an automated message. Please do not reply.</small>
//     </div>
//   `;

//   await transporter.sendMail({
//     from : `whatapps web <${process.env.EMAIL_USER}`,
//     to:email,
//     subject:'your whatsapp Verification Code',
//     html,
//   })
// }

// module.exports = sendOtpToEmail;



const nodemailer = require("nodemailer");
const dotenv = require("dotenv");

dotenv.config();

// Check if environment variables are loaded
console.log("EMAIL_USER:", process.env.EMAIL_USER);
console.log(
  "EMAIL_PASS:",
  process.env.EMAIL_PASS ? "PASS FOUND" : "PASS MISSING"
);

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // Use STARTTLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
});

transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP VERIFY ERROR:");
    console.error(error);
  } else {
    console.log("✅ Gmail configured properly and ready to send email");
  }
});

const sendOtpToEmail = async (email, otp) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>🔐 WhatsApp Verification</h2>

        <p>Your OTP is:</p>

        <h1 style="background:#e0f7fa;padding:10px;border-radius:5px;">
          ${otp}
        </h1>

        <p>This OTP is valid for 5 minutes.</p>

        <p>Please do not share this code with anyone.</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: `"WhatsApp Clone" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "WhatsApp Verification Code",
      html,
    });

    console.log("Email sent successfully");
    console.log(info.messageId);

    return info;
  } catch (error) {
    console.error("SEND MAIL ERROR:");
    console.error(error);
    throw error;
  }
};

module.exports = sendOtpToEmail;