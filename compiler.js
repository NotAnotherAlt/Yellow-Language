function parse(text) {
    return run(text).variables;
}

function run(text) {
    const variables = Object.create(null);
    const lists = Object.create(null);
    const functions = Object.create(null);
    const events = [];
    const lines = text.split(/\r?\n/);
    let index = 0;

    while (index < lines.length) {
        const source = stripInlineComment(lines[index]).trim();
        const lineNumber = index + 1;
        index += 1;
        if (!source || source.startsWith("//")) continue;

        if (source.startsWith("define ")) {
            const definition = parseDefinition(source, lineNumber);
            const parsedBody = parseBlock(lines, index);
            index = parsedBody.nextIndex;
            functions[definition.name] = {
                ...definition,
                body: parsedBody.statements
            };
            continue;
        }

        const event = source.match(/^when\s+green flag clicked$/);
        if (event) {
            const parsedBody = parseBlock(lines, index);
            index = parsedBody.nextIndex;
            events.push(parsedBody.statements);
            continue;
        }

        const statement = parseStatement(source, lineNumber, functions);
        if (!statement) {
            throw new SyntaxError(`Unsupported Yellow block on line ${lineNumber}: ${source}`);
        }
        executeStatement(statement, variables, lists, functions);
    }

    for (const eventBody of events) {
        executeStatements(eventBody, variables, lists, functions);
    }

    const callableFunctions = Object.create(null);
    for (const [name, definition] of Object.entries(functions)) {
        const callable = (...args) => {
            const localVariables = Object.create(null);
            definition.parameters.forEach((parameter, parameterIndex) => {
                localVariables[parameter] = args[parameterIndex];
            });
            executeStatements(definition.body, variables, lists, functions, localVariables);
        };
        callableFunctions[name] = callable;
        const camelName = name.replace(/\s+([a-zA-Z0-9])/g, (_, character) => character.toUpperCase());
        callableFunctions[camelName] = callable;
    }

    return { variables, lists, functions: callableFunctions };
}

function parseDefinition(source, lineNumber) {
    const header = stripInlineComment(source.slice("define ".length)).trim();
    const firstParameterMatch = header.match(/[([]/);
    const firstParameter = firstParameterMatch ? firstParameterMatch.index : -1;
    const name = (firstParameter < 0 ? header : header.slice(0, firstParameter)).trim();
    const parameters = [];
    const labels = [];
    const matches = [...header.matchAll(/\(([^)]+)\)|\[([^\]]+)\]/g)];

    matches.forEach((match, parameterIndex) => {
        const parameter = (match[1] ?? match[2]).trim();
        if (!parameter) {
            throw new SyntaxError(`Function parameter cannot be empty on line ${lineNumber}`);
        }
        parameters.push(parameter);
        const endOfLabel = matches[parameterIndex + 1]?.index ?? header.length;
        labels.push(header.slice(match.index + match[0].length, endOfLabel).trim());
    });

    if (!name) {
        throw new SyntaxError(`Function name cannot be empty on line ${lineNumber}`);
    }
    return { name, parameters, labels };
}

function parseBlock(lines, startIndex) {
    const statements = [];
    let index = startIndex;

    while (index < lines.length) {
        const rawSource = lines[index];
        const source = stripInlineComment(lines[index]).trim();
        if (rawSource === source && (/^(define|when)\s+/.test(source))) {
            return { statements, nextIndex: index, stop: null };
        }
        const lineNumber = index + 1;
        index += 1;
        if (!source || source.startsWith("//")) continue;
        if (source === "end" || source === "else") {
            return { statements, nextIndex: index, stop: source };
        }

        if (/^if\s+/.test(source)) {
            const condition = source.match(/^if\s+(.+)\s+then$/);
            if (!condition) throw new SyntaxError(`Invalid if block on line ${lineNumber}`);
            const thenBlock = parseBlock(lines, index);
            index = thenBlock.nextIndex;
            let elseBody = [];
            if (thenBlock.stop === "else") {
                const elseBlock = parseBlock(lines, index);
                index = elseBlock.nextIndex;
                elseBody = elseBlock.statements;
                if (elseBlock.stop !== "end") {
                    throw new SyntaxError(`Missing end block for if on line ${lineNumber}`);
                }
            } else if (thenBlock.stop !== "end") {
                throw new SyntaxError(`Missing end block for if on line ${lineNumber}`);
            }
            statements.push({ type: "if", condition: condition[1], body: thenBlock.statements, elseBody, lineNumber });
            continue;
        }

        const repeat = source.match(/^repeat\s+\((.*)\)$/);
        if (repeat) {
            const body = parseBlock(lines, index);
            index = body.nextIndex;
            if (body.stop !== "end") throw new SyntaxError(`Missing end block for repeat on line ${lineNumber}`);
            statements.push({ type: "repeat", count: repeat[1], body: body.statements, lineNumber });
            continue;
        }

        const repeatUntil = source.match(/^repeat until\s+(.+)$/);
        if (repeatUntil) {
            const body = parseBlock(lines, index);
            index = body.nextIndex;
            if (body.stop !== "end") throw new SyntaxError(`Missing end block for repeat until on line ${lineNumber}`);
            statements.push({ type: "repeatUntil", condition: repeatUntil[1], body: body.statements, lineNumber });
            continue;
        }

        const statement = parseStatement(source, lineNumber);
        if (!statement) {
            throw new SyntaxError(`Unsupported Yellow block on line ${lineNumber}: ${source}`);
        }
        statements.push(statement);
    }

    return { statements, nextIndex: index, stop: null };
}

function parseStatement(source, lineNumber, functions = {}) {
    source = stripInlineComment(source).trim();

    let match = source.match(/^set\s+\[([^\]]+)\s+v\]\s+to\s+(.+)$/);
    if (match) return { type: "set", name: match[1].trim(), value: match[2], lineNumber };

    match = source.match(/^change\s+\[([^\]]+)\s+v\]\s+by\s+(.+)$/);
    if (match) return { type: "change", name: match[1].trim(), amount: match[2], lineNumber };

    match = source.match(/^add\s+(.+)\s+to\s+\[([^\]]+)\s+v\]$/);
    if (match) return { type: "add", value: match[1], list: match[2].trim(), lineNumber };

    match = source.match(/^delete\s+\((.+)\)\s+of\s+\[([^\]]+)\s+v\]$/);
    if (match) return { type: "delete", index: match[1], list: match[2].trim(), lineNumber };

    match = source.match(/^replace item\s+(.+)\s+of\s+\[([^\]]+)\s+v\]\s+with\s+(.+)$/);
    if (match) {
        return {
            type: "replaceItem",
            index: match[1],
            list: match[2].trim(),
            value: match[3],
            lineNumber
        };
    }

    match = source.match(/^say\s+(\[[\s\S]*\]|\([\s\S]*\))(?:\s+for\s+\((.*)\)\s+secs)?$/);
    if (match) return { type: "say", message: match[1], lineNumber };

    match = source.match(/^wait\s+\((.*)\)\s+secs$/);
    if (match) return { type: "wait", duration: match[1], lineNumber };

    for (const [name, definition] of Object.entries(functions)) {
        if (source === name || source.startsWith(`${name} `)) {
            return {
                type: "call",
                definition,
                args: parseCallArguments(source.slice(name.length).trim(), definition, lineNumber),
                lineNumber
            };
        }
    }

    return { type: "invoke", source, lineNumber };
}

function parseCallArguments(source, definition, lineNumber) {
    if (definition.parameters.length === 0) {
        if (source) throw new SyntaxError(`Unexpected arguments on line ${lineNumber}`);
        return [];
    }

    const args = [];
    let remaining = source;
    definition.parameters.forEach((_, parameterIndex) => {
        if (parameterIndex === definition.parameters.length - 1) {
            if (!remaining) throw new SyntaxError(`Missing function argument on line ${lineNumber}`);
            args.push(remaining);
            return;
        }

        const label = definition.labels[parameterIndex];
        if (!label) throw new SyntaxError(`Missing argument label in function definition`);
        const marker = ` ${label} `;
        const boundary = findOutsideGroups(remaining, marker);
        if (boundary < 0) {
            throw new SyntaxError(`Expected "${label}" argument label on line ${lineNumber}`);
        }
        args.push(remaining.slice(0, boundary).trim());
        remaining = remaining.slice(boundary + marker.length).trim();
    });
    return args;
}

function executeStatements(statements, variables, lists, functions, localVariables = Object.create(null)) {
    for (const statement of statements) {
        executeStatement(statement, variables, lists, functions, localVariables);
    }
}

function executeStatement(statement, variables, lists, functions, localVariables = Object.create(null)) {
    switch (statement.type) {
        case "set":
            assignValue(statement.name, evaluate(statement.value, variables, lists, localVariables), variables, localVariables);
            return;
        case "change": {
            const current = getVariable(statement.name, variables, localVariables) ?? 0;
            const amount = evaluate(statement.amount, variables, lists, localVariables);
            assignValue(statement.name, Number(current) + Number(amount), variables, localVariables);
            return;
        }
        case "add":
            getList(statement.list, lists).push(evaluate(statement.value, variables, lists, localVariables));
            return;
        case "delete": {
            const list = getList(statement.list, lists);
            const index = statement.index.trim() === "all v"
                ? "all"
                : evaluate(statement.index.replace(/\s+v$/, ""), variables, lists, localVariables);
            if (index === "all") list.length = 0;
            else if (Number.isInteger(Number(index)) && Number(index) > 0) list.splice(Number(index) - 1, 1);
            return;
        }
        case "replaceItem": {
            const list = getList(statement.list, lists);
            const index = Number(evaluate(statement.index, variables, lists, localVariables));
            if (!Number.isInteger(index) || index < 1 || index > list.length) {
                throw new RangeError(`List index out of range on line ${statement.lineNumber}`);
            }
            list[index - 1] = evaluate(statement.value, variables, lists, localVariables);
            return;
        }
        case "say":
            console.log(evaluate(statement.message, variables, lists, localVariables));
            return;
        case "wait": {
            const duration = Number(evaluate(statement.duration, variables, lists, localVariables));
            if (!Number.isFinite(duration) || duration < 0) {
                throw new RangeError(`Invalid wait duration on line ${statement.lineNumber}`);
            }
            if (duration > 0) {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration * 1000);
            }
            return;
        }
        case "call": {
            const localCallVariables = Object.create(null);
            statement.definition.parameters.forEach((parameter, parameterIndex) => {
                localCallVariables[parameter] = evaluate(statement.args[parameterIndex], variables, lists, localVariables);
            });
            executeStatements(statement.definition.body, variables, lists, functions, localCallVariables);
            return;
        }
        case "invoke": {
            for (const [name, definition] of Object.entries(functions)) {
                if (statement.source === name || statement.source.startsWith(`${name} `)) {
                    const args = parseCallArguments(statement.source.slice(name.length).trim(), definition, statement.lineNumber);
                    const localCallVariables = Object.create(null);
                    definition.parameters.forEach((parameter, parameterIndex) => {
                        localCallVariables[parameter] = evaluate(args[parameterIndex], variables, lists, localVariables);
                    });
                    executeStatements(definition.body, variables, lists, functions, localCallVariables);
                    return;
                }
            }
            throw new SyntaxError(`Unknown function call on line ${statement.lineNumber}: ${statement.source}`);
        }
        case "if":
            executeStatements(
                evaluate(statement.condition, variables, lists, localVariables) ? statement.body : statement.elseBody,
                variables, lists, functions, localVariables
            );
            return;
        case "repeat": {
            const count = Number(evaluate(statement.count, variables, lists, localVariables));
            if (!Number.isInteger(count) || count < 0 || count > 100000) {
                throw new RangeError(`Invalid repeat count on line ${statement.lineNumber}`);
            }
            for (let iteration = 0; iteration < count; iteration += 1) {
                executeStatements(statement.body, variables, lists, functions, localVariables);
            }
            return;
        }
        case "repeatUntil": {
            let iterations = 0;
            while (!evaluate(statement.condition, variables, lists, localVariables)) {
                if (iterations++ >= 100000) {
                    throw new RangeError(`repeat until exceeded 100000 iterations on line ${statement.lineNumber}`);
                }
                executeStatements(statement.body, variables, lists, functions, localVariables);
            }
            return;
        }
        default:
            throw new Error(`Unknown statement type: ${statement.type}`);
    }
}

function evaluate(source, variables, lists, localVariables) {
    const value = source.trim();
    if (!value) return "";

    if (isWrapped(value, "[", "]")) return value.slice(1, -1);
    if (isWrapped(value, "<", ">")) return evaluateBoolean(value.slice(1, -1), variables, lists, localVariables);
    if (isWrapped(value, "(", ")")) {
        const inner = value.slice(1, -1).trim();
        if (hasTopLevelOperator(inner, ["+", "-"])) return evaluateArithmetic(inner, ["+", "-"], variables, lists, localVariables);
        if (hasTopLevelOperator(inner, ["*", "/"])) return evaluateArithmetic(inner, ["*", "/"], variables, lists, localVariables);
        return getVariable(inner, variables, localVariables) ?? evaluate(inner, variables, lists, localVariables);
    }

    if (value.startsWith("join ")) {
        const operands = readOperands(value.slice(5));
        if (operands) {
            return String(evaluate(operands[0], variables, lists, localVariables)) +
                String(evaluate(operands[1], variables, lists, localVariables));
        }
    }

    const length = value.match(/^length of \[([\s\S]+?)\s+v\]$/);
    if (length) return getList(length[1].trim(), lists).length;

    const textLength = value.match(/^length of \(([\s\S]*)\)$/);
    if (textLength) return String(evaluate(textLength[1], variables, lists, localVariables)).length;

    const letter = value.match(/^letter\s+\(([\s\S]*)\)\s+of\s+\(([\s\S]*)\)$/);
    if (letter) {
        const position = Number(evaluate(letter[1], variables, lists, localVariables));
        const text = String(evaluate(letter[2], variables, lists, localVariables));
        return Number.isInteger(position) && position > 0 ? text[position - 1] ?? "" : "";
    }

    const item = value.match(/^item\s+(.+)\s+of\s+\[([\s\S]+?)\s+v\]$/);
    if (item) {
        const list = getList(item[2].trim(), lists);
        const index = Number(evaluate(item[1], variables, lists, localVariables));
        return list[index - 1];
    }

    const random = value.match(/^pick random\s+\((.+)\)\s+to\s+\((.+)\)$/);
    if (random) {
        const min = Number(evaluate(random[1], variables, lists, localVariables));
        const max = Number(evaluate(random[2], variables, lists, localVariables));
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    if (hasTopLevelOperator(value, ["+", "-"])) {
        return evaluateArithmetic(value, ["+", "-"], variables, lists, localVariables);
    }
    if (hasTopLevelOperator(value, ["*", "/"])) {
        return evaluateArithmetic(value, ["*", "/"], variables, lists, localVariables);
    }

    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
    if (value === "true") return true;
    if (value === "false") return false;
    return getVariable(value, variables, localVariables) ?? value;
}

function readOperands(source) {
    const first = readGroup(source.trim());
    if (!first) return null;
    const rest = source.trim().slice(first.length).trim();
    const second = readGroup(rest);
    if (!second || rest.slice(second.length).trim()) return null;
    return [first, second];
}

function readGroup(source) {
    const opening = source[0];
    const closing = opening === "(" ? ")" : opening === "[" ? "]" : null;
    if (!closing) return null;

    let depth = 0;
    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === opening) depth += 1;
        else if (source[index] === closing && --depth === 0) return source.slice(0, index + 1);
    }
    return null;
}

function evaluateBoolean(source, variables, lists, localVariables) {
    const orParts = splitTopLevel(source, " or ");
    if (orParts.length > 1) return orParts.some(part => Boolean(evaluate(part, variables, lists, localVariables)));
    const andParts = splitTopLevel(source, " and ");
    if (andParts.length > 1) return andParts.every(part => Boolean(evaluate(part, variables, lists, localVariables)));

    const comparison = findComparison(source);
    if (!comparison) return Boolean(evaluate(source, variables, lists, localVariables));
    const left = evaluate(source.slice(0, comparison.index), variables, lists, localVariables);
    const right = evaluate(source.slice(comparison.index + comparison.operator.length), variables, lists, localVariables);
    switch (comparison.operator) {
        case ">": return Number(left) > Number(right);
        case "<": return Number(left) < Number(right);
        case ">=": return Number(left) >= Number(right);
        case "<=": return Number(left) <= Number(right);
        case "=":
        case "==": return left === right || String(left) === String(right);
        case "!=": return left !== right && String(left) !== String(right);
        default: return false;
    }
}

function evaluateArithmetic(source, operators, variables, lists, localVariables) {
    for (let index = source.length - 1; index >= 0; index -= 1) {
        if (!isTopLevelAt(source, index) || !operators.includes(source[index])) continue;
        if ((source[index] === "+" || source[index] === "-") &&
            (index === 0 || "+-*/".includes(source[index - 1]))) continue;
        const left = Number(evaluate(source.slice(0, index), variables, lists, localVariables));
        const right = Number(evaluate(source.slice(index + 1), variables, lists, localVariables));
        if (!Number.isFinite(left) || !Number.isFinite(right)) throw new TypeError(`Invalid arithmetic expression: ${source}`);
        return source[index] === "+" ? left + right
            : source[index] === "-" ? left - right
                : source[index] === "*" ? left * right
                    : left / right;
    }
    return Number(source);
}

function findComparison(source) {
    for (let index = 0; index < source.length; index += 1) {
        if (!isTopLevelAt(source, index)) continue;
        const operator = ["<=", ">=", "!=", "==", "=", "<", ">"].find(candidate => source.startsWith(candidate, index));
        if (operator) return { index, operator };
    }
    return null;
}

function splitTopLevel(source, delimiter) {
    const parts = [];
    let start = 0;
    for (let index = 0; index <= source.length - delimiter.length; index += 1) {
        if (source.startsWith(delimiter, index) && isTopLevelAt(source, index)) {
            parts.push(source.slice(start, index).trim());
            start = index + delimiter.length;
            index += delimiter.length - 1;
        }
    }
    if (parts.length) parts.push(source.slice(start).trim());
    return parts;
}

function hasTopLevelOperator(source, operators) {
    return [...source].some((character, index) => isTopLevelAt(source, index) && operators.includes(character));
}

function isTopLevelAt(source, targetIndex) {
    let round = 0;
    let square = 0;
    for (let index = 0; index < targetIndex; index += 1) {
        if (source[index] === "(") round += 1;
        else if (source[index] === ")") round -= 1;
        else if (source[index] === "[") square += 1;
        else if (source[index] === "]") square -= 1;
    }
    return round === 0 && square === 0;
}

function findOutsideGroups(source, marker) {
    for (let index = 0; index <= source.length - marker.length; index += 1) {
        if (source.startsWith(marker, index) && isTopLevelAt(source, index)) return index;
    }
    return -1;
}

function stripInlineComment(source) {
    for (let index = 0; index < source.length - 1; index += 1) {
        if (source.startsWith("//", index) && isTopLevelAt(source, index)) {
            return source.slice(0, index);
        }
    }
    return source;
}

function isWrapped(source, opening, closing) {
    if (source[0] !== opening || source[source.length - 1] !== closing) return false;
    if (opening === "<" && closing === ">") return true;
    let depth = 0;
    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === opening) depth += 1;
        else if (source[index] === closing) depth -= 1;
        if (depth === 0 && index < source.length - 1) return false;
    }
    return depth === 0;
}

function getVariable(name, variables, localVariables) {
    if (Object.prototype.hasOwnProperty.call(localVariables, name)) return localVariables[name];
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name];
    return undefined;
}

function assignValue(name, value, variables, localVariables) {
    if (Object.prototype.hasOwnProperty.call(localVariables, name)) localVariables[name] = value;
    else variables[name] = value;
}

function getList(name, lists) {
    if (!Object.prototype.hasOwnProperty.call(lists, name)) lists[name] = [];
    return lists[name];
}

module.exports = { parse, run };
