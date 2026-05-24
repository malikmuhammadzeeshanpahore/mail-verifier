const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const nodemailer = require('nodemailer');
const xlsx = require('xlsx');
const lockfile = require('proper-lockfile');

const dataDir = path.join(os.homedir(), 'Desktop', 'verifier-data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const CONFIG_FILE = fs.existsSync(path.join(dataDir, 'config.json')) ? path.join(dataDir, 'config.json') : 'config.json';
const SUBJECT_FILE = fs.existsSync(path.join(dataDir, 'subject.txt')) ? path.join(dataDir, 'subject.txt') : 'subject.txt';
const TEMPLATE_FILE = fs.existsSync(path.join(dataDir, 'template.txt')) ? path.join(dataDir, 'template.txt') : 'template.txt';
const SENT_CSV = path.join(dataDir, 'sent.csv');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function getEmailColumn(data) {
    if (data.length === 0) return null;
    const headers = Object.keys(data[0]);
    for (let h of headers) {
        if (h.toLowerCase().includes('email')) return h;
    }
    for (let h of headers) {
        for (let row of data) {
            if (row[h] && String(row[h]).includes('@')) return h;
        }
    }
    return null;
}

class Sender {
    constructor(config, excelPath) {
        this.config = config;
        
        try {
            this.inputWorkbook = xlsx.readFile(excelPath);
        } catch (err) {
            console.error("Error reading Input Excel file:", err.message);
            process.exit(1);
        }
        
        const firstSheetName = this.inputWorkbook.SheetNames[0];
        this.df_input = xlsx.utils.sheet_to_json(this.inputWorkbook.Sheets[firstSheetName]);
        this.emailCol = getEmailColumn(this.df_input);
        
        if (!this.emailCol) {
            console.error("Could not find an email column in the provided sheet.");
            process.exit(1);
        }
        console.log("Detected email column:", this.emailCol);
        
        this.transporter = nodemailer.createTransport({
            host: config.smtp_server,
            port: config.smtp_port,
            secure: config.smtp_port === 465, 
            auth: {
                user: config.email_address,
                pass: config.password
            },
            tls: { rejectUnauthorized: false }
        });
    }
    
    async getSentEmails() {
        if (!fs.existsSync(SENT_CSV)) return { df: [], set: new Set() };
        
        try {
            const release = await lockfile.lock(SENT_CSV, { retries: { retries: 5, maxTimeout: 1000 } });
            try {
                let wb = xlsx.readFile(SENT_CSV, { type: 'file' });
                let df = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                let set = new Set();
                for (let r of df) {
                    for (let key in r) {
                        let val = String(r[key]).toLowerCase().trim();
                        if (val.includes('@')) {
                            set.add(val);
                        }
                    }
                }
                return { df, set };
            } finally {
                await release();
            }
        } catch (e) {
            console.error("Could not read sent.csv due to lock:", e.message);
            return { df: [], set: new Set() };
        }
    }

    async saveRowToCSV(newRow) {
        if (!fs.existsSync(SENT_CSV)) fs.writeFileSync(SENT_CSV, '');
        
        try {
            const release = await lockfile.lock(SENT_CSV, { retries: { retries: 10, maxTimeout: 2000 } });
            try {
                let df = [];
                try {
                    let wb = xlsx.readFile(SENT_CSV, { type: 'file' });
                    df = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                } catch(e) {}
                
                df.push(newRow);
                
                const newWb = xlsx.utils.book_new();
                xlsx.utils.book_append_sheet(newWb, xlsx.utils.json_to_sheet(df), 'Sent');
                xlsx.writeFile(newWb, SENT_CSV, { bookType: 'csv' });
            } finally {
                await release();
            }
        } catch (e) {
            console.error("Failed to acquire lock to save row:", e.message);
        }
    }
    
    async sendEmail(recipient) {
        try {
            const subject = fs.readFileSync(SUBJECT_FILE, 'utf8').trim();
            const body = fs.readFileSync(TEMPLATE_FILE, 'utf8');
            
            await this.transporter.sendMail({
                from: this.config.email_address,
                to: recipient,
                subject: subject,
                text: body
            });
            return true;
        } catch (error) {
            console.log(`Failed to send email to ${recipient}:`, error.message);
            return false;
        }
    }
    
    async processSendingBatch() {
        const { set: sentEmails } = await this.getSentEmails();
        let sentCount = 0;
        
        for (let row of this.df_input) {
            const email = String(row[this.emailCol] || '').trim();
            if (!email || sentEmails.has(email.toLowerCase())) continue;
            
            console.log(`Sending email to: ${email}`);
            const success = await this.sendEmail(email);
            
            if (success) {
                let newRow = { ...row };
                const now = new Date().toISOString();
                newRow['status'] = 'sent';
                newRow['reply'] = 'no';
                newRow['sent_at'] = now;
                newRow['last_verified_at'] = now;
                
                await this.saveRowToCSV(newRow);
                sentEmails.add(email.toLowerCase());
                
                sentCount++;
                
                const minDelay = 72000; // 72 seconds
                const maxDelay = 90000; // 90 seconds
                const jitter = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
                console.log(`Email sent successfully. Applying random jitter delay of ${Math.floor(jitter/1000)} seconds...`);
                await sleep(jitter);
            }
        }
        return sentCount;
    }
    
    async run() {
        console.log("Starting Sender with Random Jitter. Press Ctrl+C to stop.");
        while (true) {
            console.log("\n--- Starting Sending Process ---");
            const sentCount = await this.processSendingBatch();
            
            if (sentCount === 0) {
                console.log("No more new emails to send. Waiting 5 minutes before checking again...");
            } else {
                console.log(`Finished processing all emails. Sent ${sentCount} emails in this run. Waiting 5 minutes...`);
            }
            
            await sleep(300000); // 5 minutes pause
        }
    }
}

if (!fs.existsSync(CONFIG_FILE)) {
    console.error("config.json not found!");
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

rl.question('Enter the path to your input Excel/CSV file (e.g. mails.xlsx): ', (excelPath) => {
    excelPath = excelPath.trim();
    
    // If it's just a filename, assume it's in the data folder
    if (path.basename(excelPath) === excelPath) {
        excelPath = path.join(dataDir, excelPath);
    }
    
    if (!fs.existsSync(excelPath)) {
        console.error("File not found: " + excelPath);
        process.exit(1);
    }
    
    const sender = new Sender(config, excelPath);
    sender.run().catch(console.error);
    rl.close();
});
