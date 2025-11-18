# Design Guidelines: TFR Construction Management Platform

## Design Approach

**Selected Approach**: Design System Foundation with Modern Productivity Tool Inspiration

**Justification**: This is a data-heavy, utility-focused internal business application requiring consistency, efficiency, and information density. Drawing from Material Design's robust component patterns combined with the clean aesthetics of Linear and Notion.

**Key Design Principles**:
- Clarity over decoration
- Efficient information architecture
- Consistent, predictable patterns
- Accessibility-first approach
- Professional, trustworthy appearance

---

## Typography

**Font Families**:
- Primary: Inter (Google Fonts) - UI text, tables, forms
- Monospace: JetBrains Mono - codes, numbers, technical data

**Hierarchy**:
- Page Titles: 2xl, font-bold (project names, section headers)
- Section Headers: xl, font-semibold (tab labels, card headers)
- Subsections: lg, font-medium (form sections, table headers)
- Body Text: base, font-normal (descriptions, form labels)
- Secondary Text: sm, font-normal (metadata, timestamps, helper text)
- Captions: xs, font-normal (table footnotes, disclaimers)

**Numbers & Data**: font-medium for emphasis in tables and dashboards

---

## Layout System

**Spacing Primitives**: Use Tailwind units of **2, 4, 6, 8, 12, 16, 20, 24** for consistent rhythm

**Common Patterns**:
- Component padding: p-6 or p-8
- Section spacing: space-y-6 or space-y-8
- Card gaps: gap-6
- Form field spacing: space-y-4
- Button padding: px-6 py-2.5
- Page margins: mx-auto max-w-7xl px-6

**Grid Structures**:
- Dashboard cards: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6
- Data tables: Full width with horizontal scroll on mobile
- Forms: Single column max-w-2xl on large screens, full width on mobile
- Project tabs: Full width content area

---

## Component Library

### Navigation
- **Top Navigation Bar**: Fixed header with logo left, user menu right, main nav center
- Height: h-16
- Sticky positioning with subtle bottom border
- User avatar + name with dropdown menu (profile, logout)

### Dashboard Cards
- **KPI Cards**: Rounded corners (rounded-lg), shadow-sm
- Structure: Icon + Label + Large Number + Trend indicator
- Padding: p-6
- Grid layout as specified above

### Data Tables
- **Standard Pattern**: Full-width with alternating row treatment
- Headers: Sticky on scroll, font-semibold, uppercase text-xs tracking-wide
- Rows: py-4 px-6, border-b
- Action buttons: Right-aligned, icon buttons or text links
- Pagination: Bottom-aligned with page numbers and prev/next
- Search/filters: Top bar with input field and filter dropdowns

### Forms
- **Input Fields**: 
  - Label above input, text-sm font-medium
  - Input: px-4 py-2.5, rounded-md, border
  - Helper text below: text-xs
  - Error state: Red border with error message below
- **Select Dropdowns**: Match input styling
- **Buttons**: 
  - Primary: px-6 py-2.5, rounded-md, font-medium
  - Secondary: Same size, outlined style
  - Destructive: Same size, distinct treatment
  - Icon buttons: p-2, rounded-md

### Tabs (Project Detail)
- **Tab Navigation**: Horizontal scroll on mobile, full width on desktop
- Active tab: Bottom border indicator, font-semibold
- Inactive tabs: font-normal, subtle hover state
- Tab content: p-6 or p-8 below tab bar

### Cards
- **Standard Card**: rounded-lg, border, shadow-sm, p-6
- **Project Card**: Include project code badge, status indicator, client name, key metadata
- **Receipt Card**: Thumbnail + details in horizontal layout

### Modals & Overlays
- **Modal**: Centered, max-w-2xl, rounded-lg, shadow-xl
- Backdrop: Semi-transparent overlay
- Close button: Top-right, icon button
- Actions: Bottom-right, primary + cancel buttons

### Status Indicators
- **Badges**: Inline, rounded-full, px-3 py-1, text-xs font-medium
- BID, PLANNING, ACTIVE, COMPLETE, CLOSED - each visually distinct
- DRAFT, SUBMITTED, WON, LOST for estimates

### File Upload
- **Upload Area**: Dashed border, rounded-lg, p-8 minimum
- Drop zone with icon, "Click to upload or drag and drop"
- File list: Show thumbnail + filename + size + remove button

### Time Entry Interface
- **Weekly View**: 7-column grid (Mon-Sun)
- Each day cell: Date header + input fields for hours
- Project selector: Dropdown above grid
- Submit: Bottom-right

### T&M Daily Sheet Form
- **Multi-section Form**: Clear visual separation between sections
- Section headers: text-lg font-semibold, mb-4
- Crew/equipment grids: Nested tables or repeatable field groups
- Signature section: Distinct visual treatment at bottom

---

## Responsive Behavior

**Breakpoints**:
- Mobile: base (< 768px) - Single column, stacked navigation
- Tablet: md (768px+) - Two columns where appropriate
- Desktop: lg (1024px+) - Full multi-column layouts
- Large: xl (1280px+) - Optimal viewing, max-w-7xl container

**Key Adaptations**:
- Navigation: Hamburger menu on mobile, full nav on desktop
- Tables: Horizontal scroll on mobile, card view alternative if needed
- Forms: Full width on mobile, max-w-2xl on desktop
- Dashboard: Stack cards on mobile, grid on tablet+

---

## Animations

**Minimal, Purposeful Only**:
- Dropdown menus: Subtle fade-in, 150ms
- Modal appearances: Scale + fade, 200ms
- Table row hover: Immediate background change, no transition
- Button interactions: No animations, instant state changes
- Page transitions: None - instant navigation

---

## Images

This is an internal business application with **no hero images**. Images are functional only:

**Document Thumbnails**: 
- PDF, image previews in Plans & Takeoff section
- Size: Consistent aspect ratio, max-w-xs in lists

**Receipt Images**:
- Thumbnail + lightbox pattern
- Grid display in receipts tab

**User Avatars**:
- Circular, 40px × 40px in navigation
- 32px × 32px in tables/lists

No decorative imagery needed - focus on data clarity and functional document display.