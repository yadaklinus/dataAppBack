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

const generateFlightTicketEmailTemplate = (data) => {
    const { userName, origin, destination, pnr, airlineName, departureTime, arrivalTime, tripType, eTicketUrl, legs } = data;
    
    const legsHtml = legs && legs.length > 0 
        ? `<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
             <h3 style="font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Itinerary Details</h3>
             ${legs.map(leg => `
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px;">
                    <span style="color: #64748b;">${leg.origin} → ${leg.destination}</span>
                    <span style="font-weight: 600;">${leg.departureTime} - ${leg.arrivalTime}</span>
                </div>
             `).join('')}
           </div>`
        : '';

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Flight Ticket - Mufti Pay</title>
        <style>
            body { font-family: 'Inter', sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #1e293b; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.05); }
            .header { background: #0f172a; padding: 40px; text-align: center; color: #ffffff; }
            .content { padding: 40px; }
            .ticket-card { background: #f1f5f9; border-radius: 16px; padding: 24px; margin-bottom: 30px; position: relative; }
            .pnr-badge { display: inline-block; background: #0f172a; color: #ffffff; padding: 4px 12px; border-radius: 6px; font-family: monospace; font-size: 18px; font-weight: bold; margin-top: 8px; }
            .btn { display: inline-block; background: #0f172a; color: #ffffff; padding: 16px 32px; border-radius: 12px; text-decoration: none; font-weight: 600; margin-top: 20px; }
            .footer { padding: 30px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #f1f5f9; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="margin:0; font-size: 24px;">MUFTI PAY</h1>
                <p style="margin: 10px 0 0; opacity: 0.8;">Your Flight Ticket is Ready</p>
            </div>
            <div class="content">
                <h2 style="font-size: 20px; margin-top: 0;">Hello ${userName},</h2>
                <p>Pack your bags! Your flight booking from <strong>${origin}</strong> to <strong>${destination}</strong> has been successfully ticketed.</p>
                
                <div class="ticket-card">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                        <div>
                            <span style="font-size: 12px; color: #64748b; text-transform: uppercase;">Airline</span>
                            <div style="font-weight: 700; font-size: 18px;">${airlineName}</div>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 12px; color: #64748b; text-transform: uppercase;">Booking Ref (PNR)</span>
                            <div><span class="pnr-badge">${pnr}</span></div>
                        </div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between;">
                        <div>
                            <span style="font-size: 12px; color: #64748b; text-transform: uppercase;">Departure</span>
                            <div style="font-weight: 600;">${departureTime}</div>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 12px; color: #64748b; text-transform: uppercase;">Arrival</span>
                            <div style="font-weight: 600;">${arrivalTime}</div>
                        </div>
                    </div>

                    ${legsHtml}
                </div>

                <div style="text-align: center;">
                    <p style="font-size: 14px; color: #64748b;">You can download your official E-Ticket using the link below:</p>
                    <a href="${eTicketUrl}" class="btn">Download E-Ticket</a>
                </div>
            </div>
            <div class="footer">
                <p>© ${new Date().getFullYear()} Mufti Pay. Safe travels!</p>
                <p>Support: <a href="mailto:support@muftipay.com" style="color: #0f172a; text-decoration: none;">support@muftipay.com</a></p>
            </div>
        </div>
    </body>
    </html>
    `;
};

module.exports = {
    generateOtpEmailTemplate,
    generateFlightTicketEmailTemplate
};
