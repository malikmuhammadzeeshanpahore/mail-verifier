const fs = require('fs');
const os = require('os');
const path = require('path');
const imaps = require('imap-simple');
const xlsx = require('xlsx');
const lockfile = require('proper-lockfile');

const dataDir = path.join(os.homedir(), 'Desktop', 'verifier-data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const CONFIG_FILE = fs.existsSync(path.join(dataDir, 'config.json')) ? path.join(dataDir, 'config.json') : 'config.json';
const SENT_CSV = path.join(dataDir, 'sent.csv');
const BOUNCED_CSV = path.join(dataDir, 'bounced.csv');
const TEMPLATE_FILE = fs.existsSync(path.join(dataDir, 'template.txt')) ? path.join(dataDir, 'template.txt') : 'template.txt';
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

function extractBouncedEmail(body) {
    const patterns = [
        /Final-Recipient: rfc822; (.*?)\r?\n/i,
        /Original-Recipient: rfc822;(.*?)\r?\n/i,
        /Your message to (.*?) couldn't be delivered/i,
        /Delivery to the following recipient failed permanently:\s+(.*?)\s+/i,
        /could not be delivered to: <(.*?)>/i,
        /address\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
        /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/
    ];
    
    for (let regex of patterns) {
        const match = body.match(regex);
        if (match) {
            let email = match[1].trim().replace(/[<>]/g, '');
            if (email.includes('@')) return email;
        }
    }
    return null;
}

function escapeCSV(str) {
    if (str === null || str === undefined) return '""';
    const s = String(str);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function appendToBouncedCSV(email, sentBody, returnedBody) {
    const headers = 'email address,email sent body,email returned body\n';
    if (!fs.existsSync(BOUNCED_CSV)) {
        fs.writeFileSync(BOUNCED_CSV, headers);
    }
    const row = `${escapeCSV(email)},${escapeCSV(sentBody)},${escapeCSV(returnedBody)}\n`;
    fs.appendFileSync(BOUNCED_CSV, row);
}

class Verifier {
    constructor(config) {
        this.config = config;
    }
    
    async readCSV() {
        if (!fs.existsSync(SENT_CSV)) return { df: [], emailCol: null };
        try {
            const release = await lockfile.lock(SENT_CSV, { retries: { retries: 5, maxTimeout: 1000 } });
            try {
                let wb = xlsx.readFile(SENT_CSV, { type: 'file' });
                let df = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
                return { df, emailCol: getEmailColumn(df) };
            } finally {
                await release();
            }
        } catch (e) {
            console.error("Could not read sent.csv due to lock:", e.message);
            return { df: [], emailCol: null };
        }
    }
    
    async saveCSV(df) {
        if (!fs.existsSync(SENT_CSV)) fs.writeFileSync(SENT_CSV, '');
        try {
            const release = await lockfile.lock(SENT_CSV, { retries: { retries: 10, maxTimeout: 2000 } });
            try {
                const newWb = xlsx.utils.book_new();
                xlsx.utils.book_append_sheet(newWb, xlsx.utils.json_to_sheet(df), 'Sent');
                xlsx.writeFile(newWb, SENT_CSV, { bookType: 'csv' });
            } finally {
                await release();
            }
        } catch (e) {
            console.error("Failed to acquire lock to save CSV:", e.message);
        }
    }
    
    async checkInbox(df, emailCol) {
        let changed = false;
        const imapConfig = {
            imap: {
                user: this.config.email_address,
                password: this.config.password,
                host: this.config.imap_server,
                port: this.config.imap_port,
                tls: true,
                tlsOptions: { rejectUnauthorized: false },
                authTimeout: 10000
            }
        };

        try {
            const connection = await imaps.connect(imapConfig);
            await connection.openBox('INBOX');
            
            const searchCriteria = ['UNSEEN'];
            const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT)', 'TEXT'], struct: true };
            const messages = await connection.search(searchCriteria, fetchOptions);
            
            for (let item of messages) {
                const headerPart = item.parts.find(p => p.which === 'HEADER.FIELDS (FROM TO SUBJECT)');
                const textPart = item.parts.find(p => p.which === 'TEXT');
                
                if (!headerPart || !headerPart.body) continue;
                
                const fromHeader = headerPart.body.from ? headerPart.body.from[0] : '';
                const subject = headerPart.body.subject ? headerPart.body.subject[0] : '';
                
                let isBounce = false;
                if (fromHeader.toLowerCase().includes('mailer-daemon') || fromHeader.toLowerCase().includes('postmaster') ||
                    subject.toLowerCase().includes('undelivered') || subject.toLowerCase().includes('delivery status notification') || 
                    subject.toLowerCase().includes('returned mail')) {
                    isBounce = true;
                }
                
                if (isBounce && textPart && textPart.body) {
                    const bouncedAddr = extractBouncedEmail(textPart.body);
                    if (bouncedAddr) {
                        for (let row of df) {
                            if (String(row[emailCol]).toLowerCase().trim() === bouncedAddr.toLowerCase().trim()) {
                                if (row['status'] !== 'bounce') {
                                    row['status'] = 'bounce';
                                    row['last_verified_at'] = new Date().toISOString();
                                    console.log(`[Status Update] ${bouncedAddr}: bounce`);
                                    changed = true;
                                    
                                    let sentBody = fs.existsSync(TEMPLATE_FILE) ? fs.readFileSync(TEMPLATE_FILE, 'utf8') : '';
                                    appendToBouncedCSV(bouncedAddr, sentBody, textPart.body);
                                }
                            }
                        }
                    }
                } else {
                    const match = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                    const replyAddr = match ? match[1] : fromHeader;
                    
                    if (replyAddr && replyAddr.includes('@')) {
                        for (let row of df) {
                            if (String(row[emailCol]).toLowerCase().trim() === replyAddr.toLowerCase().trim()) {
                                if (row['reply'] !== 'yes') {
                                    row['reply'] = 'yes';
                                    row['last_verified_at'] = new Date().toISOString();
                                    console.log(`[Reply Detected] ${replyAddr}`);
                                    changed = true;
                                }
                            }
                        }
                    }
                }
                await connection.addFlags(item.attributes.uid, ['\\Seen']);
            }
            connection.end();
        } catch (error) {
            console.log("Error checking IMAP:", error.message);
        }
        return changed;
    }
    
    checkTimeouts(df, emailCol) {
        let changed = false;
        const now = new Date();
        
        for (let row of df) {
            if (!row['sent_at']) continue;
            
            const sentTime = new Date(row['sent_at']);
            const diffMinutes = Math.abs(now - sentTime) / 60000;
            const diffHours = diffMinutes / 60;
            
            if (row['status'] === 'sent' && diffMinutes > 10) {
                row['status'] = 'not confirmed';
                row['last_verified_at'] = now.toISOString();
                console.log(`[Timeout Update] ${row[emailCol]} -> not confirmed`);
                changed = true;
            } else if (row['status'] === 'not confirmed' && diffHours > 24) {
                row['status'] = 'verified';
                row['last_verified_at'] = now.toISOString();
                console.log(`[Timeout Update] ${row[emailCol]} -> verified`);
                changed = true;
            }
        }
        return changed;
    }

    async run() {
        console.log("Starting Verifier in background. Press Ctrl+C to stop.");
        while (true) {
            const { df, emailCol } = await this.readCSV();
            if (df.length > 0 && emailCol) {
                const changed1 = await this.checkInbox(df, emailCol);
                const changed2 = this.checkTimeouts(df, emailCol);
                
                if (changed1 || changed2) {
                    await this.saveCSV(df);
                }
            }
            // Wait 30 seconds before checking again
            await sleep(30000);
        }
    }
}

if (!fs.existsSync(CONFIG_FILE)) {
    console.error("config.json not found!");
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const verifier = new Verifier(config);
verifier.run().catch(console.error);
