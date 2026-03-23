import sys

with open('client/src/components/takeoff/TakeoffSidebar.tsx', 'r') as f:
    lines = f.readlines()

with open('replacement.txt', 'r') as f:
    replacement = f.read()

new_lines = []
skip = False
for i, line in enumerate(lines):
    if '<<<<<<< HEAD' in line and (i + 1 < len(lines) and 'measurements.map((m) => (' in lines[i+1]):
        skip = True
        new_lines.append(replacement)
        continue
    if skip:
        if '>>>>>>> 7fbe422' in line:
            skip = False
        continue
    new_lines.append(line)

with open('client/src/components/takeoff/TakeoffSidebar.tsx', 'w') as f:
    f.writelines(new_lines)
