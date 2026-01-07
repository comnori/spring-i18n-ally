
// Mock vscode
const vscode = {
    workspace: {
        getConfiguration: (section) => ({
            get: (key) => []
        })
    },
    Position: class { constructor(line, char) {} },
    Range: class { constructor(start, end) {} }
};

// Mock properties-reader
const propertiesReader = require('properties-reader');

// Logic extraction for testing
function getPatterns(userPatterns = []) {
    const defaultPattern = /"([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)"/g;
    const patterns = [defaultPattern];
    for (const p of userPatterns) {
        try {
            patterns.push(new RegExp(p, 'g'));
        } catch (e) {
            console.error(`Invalid regex pattern: ${p}`, e);
        }
    }
    return patterns;
}

function verify() {
    console.log("Starting verification...");

    // Test 1: Regex Matching
    const text = 'String msg = "user.login"; String other = "cmm.error.isExistData"; String invalid = "nodot";';
    const patterns = getPatterns();
    let matches = [];

    for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            matches.push(match[1]);
        }
    }

    console.log("Matches found:", matches);
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
