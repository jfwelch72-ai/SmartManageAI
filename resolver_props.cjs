const fs = require('fs');
const content = fs.readFileSync('client/src/components/takeoff/TakeoffSidebar.tsx', 'utf8');

const lines = content.split('\n');
const newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match the start of the conflict at the end of the measurements loop
    if (line.includes('<<<<<<< HEAD') && lines[i+1] && lines[i+1].includes('<p className="text-sm text-muted-foreground">')) {
        skip = true;
        // The block we are skipping is effectively redundant because we already integrated 
        // the grouping logic and the segment rendering into the renderMeasurementItem helper.
        // We just need to close the loop properly.
        // Wait, looking at the file structure:
        // Before the replacement, the code was inside the .map loop.
        // After my previous replacement, the .map loop is now part of the IIFE/helper structure.
        // So this second conflict block is actually a leftover of the OLD .map loop that was outside.
        // We should just REMOVE this entire conflict block and the closing tags that belonged to the old loop.
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
