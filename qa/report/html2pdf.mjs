import { chromium } from "@playwright/test";
const [,, html, pdf] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage(); await p.goto("file://" + html, { waitUntil: "load" });
await p.pdf({ path: pdf, format: "Letter", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="font-size:7pt;width:100%;text-align:center;color:#666">SmartManage AI QA — SMA-QA-20261009T120012Z — page <span class="pageNumber"></span> / <span class="totalPages"></span></div>', margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" } });
await b.close();
