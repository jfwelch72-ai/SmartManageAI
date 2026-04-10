export interface FormulaContext {
  length?: number;
  area?: number;
  volume?: number;
  count?: number;
  depth?: number;
}

const SAFE_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  abs: Math.abs,
  max: (...args: number[]) => Math.max(...args),
  min: (...args: number[]) => Math.min(...args),
  sqrt: Math.sqrt,
  pow: (a: number, b: number) => Math.pow(a, b),
  pi: () => Math.PI,
};

const ALLOWED_VARS = new Set([
  "length", "area", "volume", "count", "depth",
  "lf", "sf", "cy", "qty", "pi",
]);

interface Token {
  type: "number" | "ident" | "op" | "lparen" | "rparen" | "comma";
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }
    if (/[0-9.]/.test(expr[i])) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++; }
      tokens.push({ type: "number", value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(expr[i])) {
      let ident = "";
      while (i < expr.length && /[a-zA-Z_0-9]/.test(expr[i])) { ident += expr[i]; i++; }
      tokens.push({ type: "ident", value: ident.toLowerCase() });
      continue;
    }
    if ("+-*/%".includes(expr[i])) { tokens.push({ type: "op", value: expr[i] }); i++; continue; }
    if (expr[i] === "(") { tokens.push({ type: "lparen", value: "(" }); i++; continue; }
    if (expr[i] === ")") { tokens.push({ type: "rparen", value: ")" }); i++; continue; }
    if (expr[i] === ",") { tokens.push({ type: "comma", value: "," }); i++; continue; }
    i++;
  }
  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos: number;
  private vars: Record<string, number>;

  constructor(tokens: Token[], vars: Record<string, number>) {
    this.tokens = tokens;
    this.pos = 0;
    this.vars = vars;
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  parse(): number {
    const result = this.parseExpr();
    if (this.pos < this.tokens.length) return 0;
    return result;
  }

  private parseExpr(): number {
    let left = this.parseTerm();
    while (this.peek()?.type === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.consume().value;
      const right = this.parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseUnary();
    while (this.peek()?.type === "op" && (this.peek()!.value === "*" || this.peek()!.value === "/" || this.peek()!.value === "%")) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === "*") left = left * right;
      else if (op === "/") left = right !== 0 ? left / right : 0;
      else left = right !== 0 ? left % right : 0;
    }
    return left;
  }

  private parseUnary(): number {
    if (this.peek()?.type === "op" && this.peek()!.value === "-") {
      this.consume();
      return -this.parsePrimary();
    }
    if (this.peek()?.type === "op" && this.peek()!.value === "+") {
      this.consume();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const tok = this.peek();
    if (!tok) return 0;

    if (tok.type === "number") {
      this.consume();
      const val = parseFloat(tok.value);
      return Number.isFinite(val) ? val : 0;
    }

    if (tok.type === "lparen") {
      this.consume();
      const val = this.parseExpr();
      if (this.peek()?.type === "rparen") this.consume();
      return val;
    }

    if (tok.type === "ident") {
      this.consume();
      const name = tok.value;

      if (this.peek()?.type === "lparen") {
        this.consume();
        const args: number[] = [];
        if (this.peek()?.type !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek()?.type === "comma") {
            this.consume();
            args.push(this.parseExpr());
          }
        }
        if (this.peek()?.type === "rparen") this.consume();

        const fn = SAFE_FUNCTIONS[name];
        if (fn) return fn(...args);
        return 0;
      }

      if (ALLOWED_VARS.has(name)) {
        return this.vars[name] ?? 0;
      }

      return 0;
    }

    this.consume();
    return 0;
  }
}

export function evaluateFormula(formula: string, ctx: FormulaContext): number {
  const vars: Record<string, number> = {
    length: ctx.length ?? 0,
    area: ctx.area ?? 0,
    volume: ctx.volume ?? 0,
    count: ctx.count ?? 0,
    depth: ctx.depth ?? 0,
    lf: ctx.length ?? 0,
    sf: ctx.area ?? 0,
    cy: ctx.volume ?? 0,
    qty: ctx.count ?? 0,
    pi: Math.PI,
  };

  try {
    const tokens = tokenize(formula);
    const parser = new Parser(tokens, vars);
    const result = parser.parse();
    if (typeof result !== "number" || !Number.isFinite(result)) return 0;
    return Math.max(0, result);
  } catch {
    return 0;
  }
}

export function computeAssemblyQuantity(
  formula: string,
  ctx: FormulaContext,
  wasteFactor: number
): number {
  const base = evaluateFormula(formula, ctx);
  return base * (1 + wasteFactor / 100);
}

export interface AssemblyComponentResult {
  componentId: string;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

export function computeAssemblyResults(
  components: Array<{ id: string; name: string; unit: string; unitCost: number; formula: string; wasteFactor: number }>,
  ctx: FormulaContext
): AssemblyComponentResult[] {
  return components.map(comp => {
    const qty = computeAssemblyQuantity(comp.formula || "0", ctx, comp.wasteFactor || 0);
    return {
      componentId: comp.id,
      name: comp.name,
      unit: comp.unit,
      quantity: qty,
      unitCost: comp.unitCost || 0,
      totalCost: qty * (comp.unitCost || 0),
    };
  });
}

export const FORMULA_HELP = [
  { label: "Same as measurement", example: "length", desc: "Uses the measured length directly" },
  { label: "Per stud spacing", example: "ceil(length / 1.333) + 1", desc: "16\" OC studs" },
  { label: "Both sides drywall", example: "length * depth * 2", desc: "Both sides of wall (LF * height * 2)" },
  { label: "Perimeter to area", example: "area", desc: "Uses measured area" },
  { label: "Fixed multiplier", example: "length * 2", desc: "Double the measurement" },
  { label: "Count based", example: "count", desc: "Uses the count value" },
  { label: "Round up", example: "ceil(area / 32)", desc: "Sheets of plywood (32 SF each)" },
  { label: "Square root", example: "sqrt(area)", desc: "Side length from area" },
];
