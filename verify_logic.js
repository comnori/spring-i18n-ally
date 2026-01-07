
// Mock vscode
const vscode = {
    workspace: {
        getConfiguration: (section) => ({
            get: (key) => {
                if (section === 'springI18n') {
                    if (key === 'keyRegex') return '([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)';
                    if (key === 'locales') return ['ko', 'en'];
                }
                return undefined;
            }
        })
    },
    Position: class { constructor(line, char) {} },
    Range: class { constructor(start, end) {} }
};

// Mock properties-reader
const propertiesReader = require('properties-reader');

// Logic extraction for testing
function getPattern() {
    // Mock config logic
    const rawRegex = '([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)';
    try {
        return new RegExp(rawRegex, 'g');
    } catch (e) {
        return /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
    }
}

function verify() {
    console.log("Starting verification...");

    // Test 1: Regex Matching
    // Note: The new default regex '([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)' does NOT include quotes.
    // So it will match user.login in: "user.login" -> match "user.login"
    // It will also match in: user.login (no quotes) -> match "user.login"

    const text = 'String msg = "user.login"; String other = "cmm.error.isExistData"; String invalid = "nodot";';
    const pattern = getPattern();
    let matches = [];

    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        matches.push(match[1] || match[0]);
    }

    console.log("Matches found:", matches);
    // With current regex, it should find user.login and cmm.error.isExistData.
    // It might also find "nodot" if the regex wasn't strict about dots?
    // The regex is `([a-zA-Z0-9_]+(?:\\.[a-zA-Z0-9_]+)+)` -> requires at least one dot.

    if (matches.includes("user.login") && matches.includes("cmm.error.isExistData") && !matches.includes("nodot")) {
        console.log("PASS: Default regex logic works.");
    } else {
        console.error("FAIL: Default regex logic failed.");
        process.exit(1);
    }

    // Test 2: Properties Reader
    try {
        const fs = require('fs');
        fs.writeFileSync('message_en.properties', 'user.login=Login\ncmm.error.isExistData=Data Exists');

        const props = propertiesReader('message_en.properties');
        const loginVal = props.get('user.login');
        const errVal = props.get('cmm.error.isExistData');

        console.log(`user.login: ${loginVal}`);
        console.log(`cmm.error.isExistData: ${errVal}`);

        if (loginVal === 'Login' && errVal === 'Data Exists') {
             console.log("PASS: Properties reader works.");
        } else {
             console.error("FAIL: Properties reader failed.");
             process.exit(1);
        }

        fs.unlinkSync('message_en.properties');

    } catch (e) {
        console.error("FAIL: Properties reader exception", e);
        process.exit(1);
    }
}

verify();
