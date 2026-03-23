const fs = require('fs');
const content = fs.readFileSync('client/src/components/takeoff/TakeoffSidebar.tsx', 'utf8');
const replacement = fs.readFileSync('replacement.txt', 'utf8');

const lines = content.split('\n');
const newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('<<<<<<< HEAD') && lines[i+1] && lines[i+1].includes('measurements.map((m) => (')) {
        skip = true;
        newLines.push(replacement);
        continue;
    }
    if (skip) {
        if (line.includes('>>>>>>> 7fbe422')) {
            skip = false;
        }
        continue;
    }
    newLines.push(line);
}

fs.writeFileSync('client/src/components/takeoff/TakeoffSidebar.tsx', newLines.join('\n'));
