"""
ERP Preflight — deterministic ABAP lexer / statement splitter (spec 07 §7.5, AGENTS.md Axiom 2 #3).

Static analysis runs on tokens, never on raw text, so that code inside string literals, string
templates and comments can never trigger a rule (``WRITE 'SELECT FROM MARA'.`` is a WRITE statement
with one literal operand, nothing more).

Lexical rules implemented:
* full-line comments: ``*`` in column 1;
* end-of-line comments: ``"`` outside literals;
* literals: ``'text'`` (``''`` escape), ```text``` (double back-quote escape), ``|template|``
  (``\\|`` escape; embedded ``{ expr }`` kept inside the template token). ABAP literals cannot span
  lines; an unterminated literal is closed at end of line and reported in ``LexResult.errors``;
* statements end at ``.`` outside literals; ``KEYWORD: a, b.`` chains are expanded into one
  statement per comma-separated part (commas inside parentheses do not split);
* ``EXEC SQL. … ENDEXEC.`` native blocks are kept as one opaque statement (native SQL is not ABAP).

Every token carries its exact 1-based line and column. The lexer is linear in the input size and
bounded by ``MAX_TOKENS`` / ``MAX_STATEMENTS``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

MAX_TOKENS = 2_000_000
MAX_STATEMENTS = 500_000

WORD = "WORD"
LITERAL = "LITERAL"          # '...'
TEXT_LITERAL = "TEXT"        # `...`
TEMPLATE = "TEMPLATE"        # |...|
PUNCT = "PUNCT"
NATIVE = "NATIVE"            # opaque EXEC SQL body

_WORD_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_/-~=>*<%$&#!?")
_SINGLE_PUNCT = set("().,:@[]{}+^")

# Statement-leading keywords used to recognise ABAP source (contract check) — not exhaustive syntax.
ABAP_KEYWORDS = frozenset({
    "REPORT", "PROGRAM", "FUNCTION-POOL", "CLASS", "INTERFACE", "METHOD", "METHODS", "ENDMETHOD", "ENDCLASS",
    "ENDINTERFACE", "FUNCTION", "ENDFUNCTION", "FORM", "ENDFORM", "PERFORM", "DATA", "TYPES", "CONSTANTS",
    "FIELD-SYMBOLS", "PARAMETERS", "SELECT-OPTIONS", "TABLES", "SELECT", "ENDSELECT", "INSERT", "UPDATE",
    "MODIFY", "DELETE", "LOOP", "ENDLOOP", "IF", "ELSEIF", "ELSE", "ENDIF", "CASE", "WHEN", "ENDCASE", "DO",
    "ENDDO", "WHILE", "ENDWHILE", "CALL", "WRITE", "MOVE", "CLEAR", "APPEND", "READ", "SORT", "COMMIT",
    "ROLLBACK", "RETURN", "EXIT", "CONTINUE", "CHECK", "TRY", "CATCH", "ENDTRY", "RAISE", "OPEN", "CLOSE",
    "TRANSFER", "EXEC", "ENDEXEC", "SUBMIT", "START-OF-SELECTION", "END-OF-SELECTION", "INITIALIZATION",
    "AT", "INCLUDE", "PUBLIC", "PROTECTED", "PRIVATE", "SECTION", "INTERFACES", "ALIASES", "EVENTS",
    "CLASS-DATA", "CLASS-METHODS", "ASSIGN", "UNASSIGN", "CREATE", "FREE", "CONCATENATE", "SPLIT", "REPLACE",
    "FIND", "CONDENSE", "TRANSLATE", "SHIFT", "MESSAGE", "AUTHORITY-CHECK", "ENQUEUE", "LEAVE", "SET", "GET",
    "COLLECT", "DESCRIBE", "WAIT", "EXPORT", "IMPORT", "FETCH", "OPEN", "ADD", "SUBTRACT", "MULTIPLY",
    "DIVIDE", "FORMAT", "ULINE", "SKIP", "NEW-LINE", "NEW-PAGE", "TOP-OF-PAGE", "END-OF-PAGE", "DEFINE",
    "END-OF-DEFINITION", "ASSERT", "LOG-POINT", "BREAK-POINT", "RESUME", "CLEANUP", "ENDAT", "ON", "ENDON",
    "PROVIDE", "ENDPROVIDE", "SELECTION-SCREEN", "MODULE", "ENDMODULE", "PROCESS", "TYPE-POOLS", "TYPE-POOL",
    "LOCAL", "DEFERRED", "RANGES", "STATICS", "NODES", "CONVERT", "GENERATE", "SYNTAX-CHECK", "INSERT",
    "OVERLAY", "WITH", "ENDWITH", "RECEIVE", "SUPPRESS", "EVENT", "ENHANCEMENT", "ENDENHANCEMENT",
})


@dataclass(frozen=True)
class Token:
    kind: str
    value: str
    line: int
    col: int

    @property
    def upper(self) -> str:
        return self.value.upper()

    def is_word(self, *values: str) -> bool:
        return self.kind == WORD and (not values or self.value.upper() in values)

    def is_punct(self, value: str) -> bool:
        return self.kind == PUNCT and self.value == value


@dataclass
class Statement:
    tokens: List[Token]
    chained: bool = False

    @property
    def line(self) -> int:
        return self.tokens[0].line if self.tokens else 0

    @property
    def col(self) -> int:
        return self.tokens[0].col if self.tokens else 0

    @property
    def keyword(self) -> str:
        return self.tokens[0].upper if self.tokens and self.tokens[0].kind == WORD else ""

    def words(self) -> List[str]:
        return [t.upper for t in self.tokens if t.kind == WORD]

    def text(self) -> str:
        return " ".join(t.value for t in self.tokens)


@dataclass
class LexResult:
    tokens: List[Token] = field(default_factory=list)
    errors: List[Tuple[int, int, str]] = field(default_factory=list)


class AbapLexError(ValueError):
    pass


def tokenize(source: str) -> LexResult:
    """Tokenizes ABAP source into WORD / literal / PUNCT tokens with exact positions."""
    result = LexResult()
    tokens = result.tokens
    lines = source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    for line_no, line in enumerate(lines, start=1):
        if line.startswith("*"):
            continue
        i = 0
        n = len(line)
        while i < n:
            ch = line[i]
            if ch in " \t\f\v\x00":
                i += 1
                continue
            if ch == '"':
                break  # end-of-line comment
            if ch in ("'", "`", "|"):
                start = i
                quote = ch
                i += 1
                closed = False
                while i < n:
                    c = line[i]
                    if quote == "|" and c == "\\" and i + 1 < n:
                        i += 2
                        continue
                    if c == quote:
                        if quote != "|" and i + 1 < n and line[i + 1] == quote:
                            i += 2  # doubled quote escape
                            continue
                        closed = True
                        i += 1
                        break
                    i += 1
                if not closed:
                    result.errors.append((line_no, start + 1, f"unterminated {quote} literal"))
                kind = LITERAL if quote == "'" else TEXT_LITERAL if quote == "`" else TEMPLATE
                tokens.append(Token(kind, line[start:i], line_no, start + 1))
            elif ch == ".":
                tokens.append(Token(PUNCT, ".", line_no, i + 1))
                i += 1
            elif ch in _SINGLE_PUNCT:
                tokens.append(Token(PUNCT, ch, line_no, i + 1))
                i += 1
            else:
                start = i
                while i < n and line[i] not in " \t\f\v\x00'`|\".()[]{},:@+^":
                    i += 1
                if i == start:  # unknown single character — keep as punctuation
                    tokens.append(Token(PUNCT, ch, line_no, i + 1))
                    i += 1
                else:
                    tokens.append(Token(WORD, line[start:i], line_no, start + 1))
            if len(tokens) > MAX_TOKENS:
                raise AbapLexError(f"ABAP source exceeds {MAX_TOKENS} tokens.")
    return result


def _split_chain(stmt_tokens: List[Token]) -> List[Statement]:
    """Expands ``PREFIX: a, b, c`` into ``PREFIX a`` / ``PREFIX b`` / ``PREFIX c`` (depth-aware)."""
    colon_idx = next((k for k, t in enumerate(stmt_tokens) if t.is_punct(":")), None)
    if colon_idx is None:
        return [Statement(stmt_tokens)]
    prefix = stmt_tokens[:colon_idx]
    parts: List[List[Token]] = [[]]
    depth = 0
    for t in stmt_tokens[colon_idx + 1:]:
        if t.is_punct("(") or t.is_punct("["):
            depth += 1
        elif t.is_punct(")") or t.is_punct("]"):
            depth = max(0, depth - 1)
        if t.is_punct(",") and depth == 0:
            parts.append([])
            continue
        parts[-1].append(t)
    out = [Statement(prefix + p, chained=True) for p in parts if p or prefix]
    return out or [Statement(prefix)]


def split_statements(tokens: List[Token]) -> List[Statement]:
    statements: List[Statement] = []
    current: List[Token] = []
    i = 0
    n = len(tokens)
    while i < n:
        t = tokens[i]
        if t.is_punct("."):
            if current:
                # EXEC SQL. <native> ENDEXEC.  -> one opaque statement
                if len(current) >= 2 and current[0].is_word("EXEC") and current[1].is_word("SQL"):
                    j = i + 1
                    while j < n and not tokens[j].is_word("ENDEXEC"):
                        j += 1
                    native = [Token(NATIVE, tk.value, tk.line, tk.col) for tk in tokens[i + 1:j]]
                    statements.append(Statement(current + native))
                    current = []
                    i = j  # ENDEXEC starts the next statement
                    continue
                statements.extend(_split_chain(current))
                if len(statements) > MAX_STATEMENTS:
                    raise AbapLexError(f"ABAP source exceeds {MAX_STATEMENTS} statements.")
                current = []
            i += 1
            continue
        current.append(t)
        i += 1
    if current:
        statements.extend(_split_chain(current))
    return statements


def parse_statements(source: str) -> Tuple[List[Statement], LexResult]:
    lex = tokenize(source)
    return split_statements(lex.tokens), lex


def looks_like_abap(source: str) -> Optional[str]:
    """Contract check: None when the text is plausibly ABAP source, else a reason."""
    try:
        statements, _ = parse_statements(source)
    except AbapLexError as exc:
        return str(exc)
    if not statements:
        return "no ABAP statements found (only comments or whitespace)."
    recognised = sum(1 for s in statements if s.keyword in ABAP_KEYWORDS or _is_expression_statement(s))
    if recognised == 0:
        return "text does not contain any ABAP statement (no ABAP keyword starts a statement)."
    if recognised * 2 < len(statements):
        return (
            f"only {recognised} of {len(statements)} statements start with an ABAP keyword; "
            "the payload does not look like ABAP source."
        )
    return None


def _is_expression_statement(stmt: Statement) -> bool:
    """Assignments (``lv = …``, ``DATA(x) = …``) and functional method calls (``lo->m( )``, ``cl=>m( )``)."""
    toks = stmt.tokens
    if not toks or toks[0].kind != WORD:
        return False
    if len(toks) >= 2 and toks[1].is_punct("(") and ("->" in toks[0].value or "=>" in toks[0].value):
        return True
    return any(t.kind == WORD and t.value in ("=", "?=", "+=", "-=", "*=", "/=", "&&=") for t in toks[1:6])


__all__ = [
    "Token",
    "Statement",
    "LexResult",
    "AbapLexError",
    "tokenize",
    "split_statements",
    "parse_statements",
    "looks_like_abap",
    "ABAP_KEYWORDS",
    "WORD",
    "LITERAL",
    "TEXT_LITERAL",
    "TEMPLATE",
    "PUNCT",
    "NATIVE",
]
