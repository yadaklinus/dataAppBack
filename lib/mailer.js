const { Resend } = require('resend');

/**
 * Sends an email using the Resend HTTP API to bypass Render SMTP restrictions.
 * @param {Object} options - Email options.
 * @param {string} options.to - Recipient email.
 * @param {string} options.subject - Email subject.
 * @param {string} options.text - Plain text content.
 * @param {string} options.html - HTML content.
 */
const sendEmail = async (options) => {
    try {
        // Initialize Resend with the API key
        // Note: You must add RESEND_API_KEY to your Render environment variables
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Resend requires a verified domain to send FROM.
        // It's best to use RESEND_FROM_EMAIL for your verified domain (e.g. no-reply@yourdomain.com)
        const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_USER || 'onboarding@resend.dev';
        const senderName = process.env.APP_NAME || 'Data Padi';

        const { data, error } = await resend.emails.send({
            from: `${senderName} <${fromEmail}>`,
            to: [options.to],
            subject: options.subject,
            text: options.text,
            html: options.html,
        });

        if (error) {
            console.error("Resend API Error:", error);
            throw new Error(`Failed to send email via Resend: ${error.message}`);
        }

        console.log("Email sent successfully via Resend. ID:", data?.id);
        return data;

    } catch (error) {
        console.error("Error sending email:", error.message);
        throw error;
    }
};

module.exports = sendEmail;
