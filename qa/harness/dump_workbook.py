import sys, openpyxl
p=sys.argv[1]
wf=openpyxl.load_workbook(p, data_only=False)
wv=openpyxl.load_workbook(p, data_only=True)
print("sheets", wf.sheetnames, "defined names", list(wf.defined_names.keys()) if hasattr(wf.defined_names,'keys') else wf.defined_names)
for ws in wf.worksheets:
    wsv=wv[ws.title]
    print("SHEET",ws.title,"dims",ws.dimensions,"max",ws.max_row,ws.max_column, "state", ws.sheet_state)
    print("merged", ws.merged_cells.ranges)
    print("hidden rows", [r for r,d in ws.row_dimensions.items() if d.hidden])
    print("hidden cols", [c for c,d in ws.column_dimensions.items() if d.hidden])
    print("col widths", {c:d.width for c,d in ws.column_dimensions.items()})
    print("freeze", ws.freeze_panes, "autofilter", ws.auto_filter.ref, "print area", ws.print_area)
    print("data validations", ws.data_validations.dataValidation if ws.data_validations else None)
    print("cond fmt", list(ws.conditional_formatting))
    for row in ws.iter_rows():
        for c in row:
            if c.value is None and c.comment is None: continue
            v=wsv[c.coordinate].value
            f=c.value if isinstance(c.value,str) and c.value.startswith('=') else ''
            cm=(' COMMENT:'+repr(c.comment.text)) if c.comment else ''
            print(f"{c.coordinate}\t{repr(c.value) if not f else 'F:'+f}\t{'cached='+repr(v) if f else ''}\tfmt={c.number_format}{cm}")
