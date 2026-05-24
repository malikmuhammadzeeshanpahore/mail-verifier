# Mail Verifier & Sender Tool

This tool is designed to automate the process of sending emails and verifying bounces/replies via IMAP, with random jitter built-in to avoid spam filters.

## Installation

You can install this tool easily on Windows or Linux. It will compile the source code into standalone executables and place them on your Desktop, along with a data folder (`verifier-data`).

### On Windows
1. Ensure you have Node.js installed.
2. Double-click `install.bat` (or run it via Command Prompt).
3. The script will install dependencies, compile the code, and place `sender.exe` and `verifier.exe` on your Desktop.
4. It will also create a `verifier-data` folder on your Desktop containing configuration files.

### On Linux
1. Ensure you have Node.js installed.
2. Open terminal in the project directory.
3. Run `chmod +x install.sh`
4. Run `./install.sh`
5. The script will place `sender` and `verifier` executables on your Desktop.

---

## Usage

All your settings, email lists, and output files are managed in the **`verifier-data`** folder on your Desktop.

### 1. Configuration
Open the `verifier-data` folder on your Desktop. Make sure the following files are properly filled out:
* **`config.json`**: Add your SMTP/IMAP credentials.
* **`subject.txt`**: Enter the subject line for your emails.
* **`template.txt`**: Enter the body text for your emails.

### 2. Sending Emails
1. Copy your Excel or CSV file containing email addresses (e.g., `mails.xlsx`) into the `verifier-data` folder.
2. Run the `sender` executable on your Desktop (double-click `sender.exe` on Windows or run `./sender` on Linux).
3. When prompted, just type the name of your file (e.g., `mails.xlsx`). The program will automatically find it in the `verifier-data` folder.
4. The sender will start sending emails with a random delay (72 - 90 seconds) between each email to prevent spam blocks.
5. All sent emails will be logged into `sent.csv` inside the `verifier-data` folder.

### 3. Verifying Bounces & Replies
1. Run the `verifier` executable on your Desktop.
2. The verifier will run in the background, constantly checking your inbox for bounces or replies.
3. It updates `sent.csv` with the latest status.
4. If an email bounces, it logs the full details (email, sent body, returned body) into `bounced.csv` in the `verifier-data` folder.

## Notes
- Do not delete the `verifier-data` folder as it acts as the central database for this tool.
- If you want to use a file located outside of `verifier-data`, you can provide the full absolute path when running the sender (e.g., `C:\Users\Name\Downloads\list.xlsx`).
