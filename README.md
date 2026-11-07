# Yellow-Language

## Variables

Use `set [name v] to (value)` to create or update a variable:

```yellow
set [score v] to (1)
set [nextScore v] to (score)
```

Values in parentheses are numbers, `true`/`false`, or text. If the value matches
an existing variable name, that variable's value is copied.

Run a Yellow file with `node yellow.js script.yellow`. If no filename is
provided, it runs `script.yellow` in the current directory. Node does not
execute `.yellow` files directly; `yellow.js` loads the file and runs it
through the interpreter. The terminal only displays output from `say` blocks.

## Functions, lists, and control blocks

Define a function with parameters in parentheses. Blocks end with `end`;
function definitions can also end when the next top-level definition begins.
The words between parameters are labels, and function calls use those labels:

```yellow
define add score (amount)
change [score v] by (amount)
end

when green flag clicked
add score (10)
if <(score) > (50)> then
  add [High score!] to [logs v]
else
  add [Keep going!] to [logs v]
end
```

Supported blocks include variable assignment and change, list add/delete/replace,
`repeat`, `repeat until`, `if`/`else`, `say`, and `wait`. Expressions support
arithmetic, comparisons, `and`/`or`, text length and letter reporters, list
length and item reporters, `join`, and `pick random`. Lists use one-based
indexes; `(all v)` clears a list. A green-flag event runs after definitions have
been read. `say [text]` and `say (reporter)` write to the console; an optional
`say` duration is currently syntax only. Syntax follows scratchblocks input
shapes: `[text]`, `(reporter)`, and `<boolean>`. Inline comments start with
`//`.

`run` returns `variables`, `lists`, and callable `functions`. For example,
`result.functions.addScore(10)` invokes the defined function after the script
has run. Variables changed by a function are stored in `result.variables`.