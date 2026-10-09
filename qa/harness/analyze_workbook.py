import sys, re, json, openpyxl
from decimal import Decimal
p=sys.argv[1]; out=sys.argv[2]
wf=openpyxl.load_workbook(p); wv=openpyxl.load_workbook(p,data_only=True)
ws=wf.active; vs=wv.active
TEMPL={'F':'=B{r}*D{r}*E{r}','H':'=B{r}*G{r}','J':'=B{r}*D{r}*I{r}','L':'=B{r}*K{r}','N':'=M{r}*B{r}',
 'O':'=SUM(F{r},H{r},J{r},L{r},N{r})','P':'=(F{r}/(1-$R$2))+(H{r}/(1-$R$3))+(J{r}/(1-$R$4))+(L{r}/(1-$R$5))+(N{r}/(1-$R$6))',
 'Q':'=IF(P{r}=0,0,P{r}-O{r})','R':'=IF(Q{r}=0,"",Q{r}/P{r})'}
rates={k:ws[c].value for k,c in zip(['F','H','J','L','N'],['R2','R3','R4','R5','R6'])}
def num(x): return x if isinstance(x,(int,float)) else 0
rows=[]; dev=[]
for r in range(11,120):
    cells={c:ws[f'{c}{r}'].value for c in 'ABCDEFGHIJKLMNOPQRST'}
    cached={c:vs[f'{c}{r}'].value for c in 'FHJLNOPQR'}
    for c,t in TEMPL.items():
        v=cells[c]; exp=t.format(r=r)
        if v is None: continue
        if v!=exp: dev.append({'cell':f'{c}{r}','actual':v,'template':exp,'cached':cached.get(c)})
    # independent compute using literal inputs, following row's actual formula semantics only where standard
    B,D,E,G,I,K,M=(num(cells[x]) for x in 'BDEGIKM')
    F=B*D*E; H=B*G; J=B*D*I; L=B*K; N=M*B; O=F+H+J+L+N
    P=sum(v/(1-rates[k]) for k,v in zip('FHJLN',[F,H,J,L,N]))
    # if P overridden by literal, record
    Pact=cells['P'] if not (isinstance(cells['P'],str) and cells['P'].startswith('=')) else None
    a=cells['A']; inputs_present=any(isinstance(cells[x],(int,float)) and cells[x]!=0 for x in 'BDEGIKM')
    if r==119 or r>112: kind='blank/total-area'
    elif a is None and not inputs_present: kind='blank'
    elif inputs_present: kind='item'
    else: kind='header/note'
    rows.append(dict(row=r,kind=kind,A=a,B=cells['B'],C=cells['C'],D=cells['D'],E=cells['E'],G=cells['G'],I=cells['I'],K=cells['K'],M=cells['M'],
        calc=dict(F=F,H=H,J=J,L=L,N=N,O=O,P=P,Q=(P-O if P else 0)), cached=cached, P_literal=Pact, S=cells['S'],T=cells['T']))
tot={c:ws[f'{c}120'].value for c in 'ABCDEFGHIJKLMNOPQRST'}
totc={c:vs[f'{c}120'].value for c in 'ABCDEFGHIJKLMNOPQRST'}
json.dump(dict(rates=rates,rows=rows,deviations=dev,total_formulas=tot,total_cached=totc),open(out,'w'),indent=1,default=str)
print("rates",rates)
print("DEVIATIONS:")
for d in dev: print(d)
print("ROW120 formulas:",{k:v for k,v in tot.items() if v is not None})
print("ROW120 cached:",{k:v for k,v in totc.items() if v is not None})
# other cells outside A11:R119 data
for r in range(113,121):
    vals={c:ws[f'{c}{r}'].value for c in 'ABCDEFGHIJKLMNOPQRST' if ws[f'{c}{r}'].value is not None}
    if vals and r!=120: print("row",r,vals)
