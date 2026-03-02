/**
 * Generates a premium HTML email template for OTPs.
 * @param {string} otp - The 6-digit OTP code.
 * @param {string} userName - (Optional) The user's name.
 * @returns {string} The full HTML string.
 */
const generateOtpEmailTemplate = (otp, userName = "Valued Customer") => {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Secure OTP Verification</title>
        <style>
            body {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                background-color: #f4f7f6;
                margin: 0;
                padding: 0;
                color: #333333;
            }
            .email-wrapper {
                width: 100%;
                background-color: #f4f7f6;
                padding: 40px 0;
            }
            .email-container {
                max-width: 600px;
                margin: 0 auto;
                background-color: #ffffff;
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 10px 25px rgba(0,0,0,0.05);
            }
            .header {
                background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
                padding: 30px;
                text-align: center;
                color: #ffffff;
            }
            .header h1 {
                margin: 0;
                font-size: 24px;
                font-weight: 700;
                letter-spacing: 1px;
            }
            .content {
                padding: 40px 30px;
                text-align: center;
            }
            .content h2 {
                font-size: 22px;
                color: #2a5298;
                margin-top: 0;
                margin-bottom: 20px;
            }
            .content p {
                font-size: 16px;
                line-height: 1.6;
                color: #555555;
                margin-bottom: 30px;
            }
            .otp-box {
                background-color: #f8fafc;
                border: 2px dashed #cbd5e1;
                border-radius: 12px;
                padding: 24px;
                margin: 0 auto 30px auto;
                max-width: 300px;
            }
            .otp-code {
                font-family: 'Courier New', Courier, monospace;
                font-size: 36px;
                font-weight: 700;
                color: #0f172a;
                letter-spacing: 8px;
                margin: 0;
            }
            .security-notice {
                font-size: 14px;
                color: #64748b;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            .footer {
                background-color: #f8fafc;
                padding: 24px 30px;
                text-align: center;
                border-top: 1px solid #e2e8f0;
            }
            .footer p {
                font-size: 13px;
                color: #64748b;
                margin: 5px 0;
            }
            .footer a {
                color: #2a5298;
                text-decoration: none;
            }
        </style>
    </head>
    <body>
        <div class="email-wrapper">
            <div class="email-container">
                <!-- Header -->
                <div class="header">
                    <h1>MUFTI PAY</h1>
                </div>
                
                <!-- Body Content -->
                <div class="content">
                    <h2>Password Reset Request</h2>
                    <p>Hello <strong>${userName}</strong>,<br><br>We received a request to reset the password for your Mufti Pay account. Enter the authorization code below to successfully verify your identity.</p>
                    
                    <div class="otp-box">
                        <h1 class="otp-code">${otp}</h1>
                    </div>
                    
                    <p class="security-notice">
                        <span style="font-size: 18px;">🔒</span> 
                        This code will securely expire in exactly 10 minutes.
                    </p>
                    <p style="font-size: 14px; color: #94a3b8; margin-top: 30px;">
                        If you did not request a password reset, please ignore this email or contact support if you have concerns.
                    </p>
                </div>
                
                <!-- Footer -->
                <div class="footer">
                    <p>© ${new Date().getFullYear()} Mufti Pay. All rights reserved.</p>
                    <p>Do you need help? <a href="mailto:support@muftipay.com">Contact Support</a></p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
};

module.exports = {
    generateOtpEmailTemplate
};
