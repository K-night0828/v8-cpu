app.service('uploader', ['opcodes', function (opcodes) {
    return {
        go: function (input) {
            // Contains the program code & data generated by the assembler
            var code = [];
            // Contains the mapping from instructions to assembler line
            var mapping = {};
            // Hash map of label used to replace the labels after the assembler generated the code
            var labels = {};
            // Split text into code lines
            var lines = input.split('\n');
            for (var i = 0, l = lines.length; i < l; i++) {
                var codes = input.split(' ');
                for (var j = 0, codenum = codes.length; j < codenum; j++) {
                    var codevalue=parseInt(codes[j].slice(0,2), 16);
                    if (codevalue < 0 || codevalue > 255) {
                        throw "code must be a value between 0...255";
                    }
                    code.push(codevalue);
                }
            }
            return {code: code, mapping: mapping, labels: labels};
        }
    };
}]);

app.service('assembler', ['opcodes', function (opcodes) {
    return {
        go: function (input) {
            // Use https://www.debuggex.com/
            // Matches: "label: INSTRUCTION OPERAND1, OPERAND2, OPERAND3
            // GROUPS:     1         3         4         7         10
            var regex = /^[\t ]*(?:([.A-Za-z]\w*)(@\w+)?[:])?(?:[\t ]*([A-Za-z]{2,6})(?:[\t ]+([.A-Za-z0-9]\w*((\+|-)\d+)?)(?:[\t ]*[,][\t ]*([.A-Za-z0-9]\w*((\+|-)\d+)?)(?:[\t ]*[,][\t ]*([.A-Za-z0-9]\w*((\+|-)\d+)?))?)?)?)?/;
                //^[\t ]*(?:([.A-Za-z]\w*)(@\w+)?[:])?  -- label: or nothing
                //(?:[\t ]*([A-Za-z]{2,6})              -- instruction
                //([.A-Za-z0-9]\w*((\+|-)\d+)?)         -- (OPERAND1)
            // Regex group indexes for operands
            var op1_group = 4;
            var op2_group = 7;
            var op3_group = 10;
            // MATCHES: "(+|-)INTEGER"
            var regexNum = /^[-+]?[0-9]+$/;
            // MATCHES: "(.L)abel"
            var regexLabel = /^([.A-Za-z_]\w*)((\+|-)\d+)?$/;
            // Contains the program code & data generated by the assembler
            var memory = [];
            // The address where the next instruction/data will be placed at
            var current = 0;
            // Contains the mapping from instructions to assembler line
            var mapping = {};
            // Hash map of label used to replace the labels after the assembler generated the code
            var labels = {};
            // Hash of uppercase labels used to detect duplicates
            var normalizedLabels = {};

            // Split text into code lines
            var lines = input.split('\n');

            // Allowed formats: 200, 200d, 0xA4, 0o48, 101b
            var parseNumber = function (input) {
                if (input.slice(0, 2) === "0x") {
                    return parseInt(input.slice(2), 16);
                } else if (regexNum.exec(input)) {
                    return parseInt(input, 10);
                } else {
                    return undefined;
                }
            };

            // Allowed registers: R0 - RF
            var parseRegister = function (input) {
                input = input.toUpperCase();
                if (input === 'R0') {
                    return 0;
                } else if (input === 'R1') {
                    return 1;
                } else if (input === 'R2') {
                    return 2;
                } else if (input === 'R3') {
                    return 3;
                } else if (input === 'R4') {
                    return 4;
                } else if (input === 'R5') {
                    return 5;
                } else if (input === 'R6') {
                    return 6;
                } else if (input === 'R7') {
                    return 7;
                } else if (input === 'R8') {
                    return 8;
                } else if (input === 'R9') {
                    return 9;
                } else if (input === 'RA') {
                    return 10;
                } else if (input === 'RB') {
                    return 11;
                } else if (input === 'RC') {
                    return 12;
                } else if (input === 'RD') {
                    return 13;
                } else if (input === 'RE') {
                    return 14;
                } else if (input === 'RF') {
                    return 15;
                } else {
                    return undefined;
                }
            };

            var parseAddress = function (input) {
                var number = parseNumber(input);
                if (number !== undefined) {
                    if (number >= 0 && number <= 255)
                        return number;
                    throw "addresses must have a value between 0-255";
                }

                var match = regexLabel.exec(input);
                if (match[1] === undefined)
                    return undefined;
                var offset = 0;
                if (match[2] !== undefined) {
                    var sign = match[2][0] === '-' ? -1 : 1;
                    offset = sign * parseInt(match[2].slice(1), 10);
                }
                return {label: match[1], offset: offset};
            };

            var addLabel = function (label, address) {
                var upperLabel = label.toUpperCase();
                if (upperLabel in normalizedLabels)
                    throw "Duplicate label: " + label;

                if (address === undefined) {
                    labels[label] = current;
                } else if (address >= 0 && address <= 255) {
                    labels[label] = address;
                    current = address;
                    while (memory.length < current)
                        memory.push(0);
                } else {
                    throw "addresses must have a value between 0-255";
                }
            };

            var checkNoExtraArg = function (instr, arg) {
                if (arg !== undefined) {
                    throw instr + ": too many arguments";
                }
            };

            var generate = function () {
                for (var arg in arguments) {
                    var datum = arguments[arg];
                    if (current < 0 || current > 255)
                        throw "Too many code/data";
                    if (current == memory.length)
                        memory.push(datum);
                    else if (current < memory.length)
                        memory[current] = datum;
                    current += 1;
                }
            };

            for (var i = 0, l = lines.length; i < l; i++) {
                try {
                    var match = regex.exec(lines[i]);
                    if (match[1] !== undefined || match[3] !== undefined) {
                        if (match[1] !== undefined) {
                            // TODO: Support hardcoded addresses
                            var address = match[2];
                            if (address !== undefined)
                                address = parseNumber(address.slice(1));
                            addLabel(match[1], address);
                        }

                        if (match[3] !== undefined) {
                            var instr = match[3].toUpperCase();
                            var p1, p2, p3, opCode;

                            // Add mapping instr pos to line number
                            // Don't do it for DB as this is not a real instruction
                            if (instr !== 'DB') {
                                mapping[current] = i;
                            }

                            switch (instr) {
                            case 'DB':
                                p1 = parseNumber(match[op1_group]);
                                if (p1 !== undefined)
                                    generate(p1 & 0xFF);
                                else
                                    throw "DB does not support this operand";
                                break;
                            case 'HALT':
                                checkNoExtraArg('HALT', match[op1_group]);
                                checkNoExtraArg('HALT', match[op2_group]);
                                checkNoExtraArg('HALT', match[op3_group]);
                                generate(opcodes.HALT << 4, 0);
                                break;
                            case 'MOVE':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseRegister(match[op2_group]);
                                checkNoExtraArg('MOVE', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.MOVE << 4, (p2 << 4) | p1);
                                else
                                    throw "MOVE does not support this operands";
                                break;
                            case 'ADDI':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseRegister(match[op2_group]);
                                p3 = parseRegister(match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined && p3 !== undefined)
                                    generate(opcodes.ADD_INT << 4 | p1, (p2 << 4) | p3);
                                else
                                    throw "ADDI does not support this operands";
                                break;
                            case 'ADDF':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseRegister(match[op2_group]);
                                p3 = parseRegister(match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined && p3 !== undefined)
                                    generate(opcodes.ADD_FLOAT << 4 | p1, (p2 << 4) | p3);
                                else
                                    throw "ADDF does not support this operands";
                                break;
                            case 'LOADM':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseAddress(match[op2_group]);
                                checkNoExtraArg('LOADM', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.LOAD_FROM_MEMORY << 4 | p1, p2);
                                else
                                    throw "LOADM does not support this operands";
                                break;
                            case 'LOADB':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseAddress(match[op2_group]);
                                checkNoExtraArg('LOADB', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.LOAD_WITH_CONSTANT << 4 | p1, p2);
                                else
                                    throw "LOADB does not support this operands";
                                break;
                            case 'LOADP':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseRegister(match[op2_group]);
                                checkNoExtraArg('LOADP', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.LOAD_FROM_POINTER << 4 | p1, p2);
                                else
                                    throw "LOADP does not support this operands";
                                break;
                            case 'STOREM':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseAddress(match[op2_group]);
                                checkNoExtraArg('STOREM', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.STORE_TO_MEMORY << 4 | p1, p2);
                                else
                                    throw "STOREM does not support this operands";
                                break;
                            case 'STOREP':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseRegister(match[op2_group]);
                                checkNoExtraArg('STOREP', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.STORE_TO_POINTER << 4 | p1, p2);
                                else
                                    throw "STOREP does not support this operands";
                                break;
                            case 'JUMP':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseAddress(match[op2_group]);
                                checkNoExtraArg('JUMP', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.JUMP_IF_EQUAL << 4 | p1, p2);
                                else
                                    throw "JUMP does not support this operands";
                                break;
                            case 'JUMPL':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseAddress(match[op2_group]);
                                checkNoExtraArg('JUMPL', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.JUMP_IF_LESS << 4 | p1, p2);
                                else
                                    throw "JUMPL does not support this operands";
                                break;
                            case 'AND':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseRegister(match[op2_group]);
                                p3 = parseRegister(match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined && p3 !== undefined)
                                    generate(opcodes.AND << 4 | p1, (p2 << 4) | p3);
                                else
                                    throw "AND does not support this operands";
                                break;
                            case 'OR':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseRegister(match[op2_group]);
                                p3 = parseRegister(match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined && p3 !== undefined)
                                    generate(opcodes.OR << 4 | p1, (p2 << 4) | p3);
                                else
                                    throw "OR does not support this operands";
                                break;
                            case 'XOR':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseRegister(match[op2_group]);
                                p3 = parseRegister(match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined && p3 !== undefined)
                                    generate(opcodes.XOR << 4 | p1, (p2 << 4) | p3);
                                else
                                    throw "XOR does not support this operands";
                                break;
                            case 'ROT':
                                p1 = parseRegister(match[op1_group]);
                                p2 = parseNumber(match[op2_group]);
                                checkNoExtraArg('ROT', match[op3_group]);
                                if (p1 !== undefined && p2 !== undefined)
                                    generate(opcodes.ROTATE << 4 | p1, p2);
                                else
                                    throw "LOADB does not support this operands";
                                break;
                            default:
                                throw "Invalid instruction: " + match[2];
                            }
                        }
                    } else {
                        // Check if line starts with a comment otherwise the line contains an error and can not be parsed
                        var line = lines[i].trim();
                        if (line !== "" && line.slice(0, 1) !== ";") {
                            throw "Syntax error";
                        }
                    }
                } catch (e) {
                    throw {error: e, line: i};
                }
            }

            // Replace label
            for (i = 0, l = memory.length; i < l; i++) {
                if (!angular.isNumber(memory[i])) {
                    var pair = memory[i];
                    if (pair.label in labels) {
                        memory[i] = (labels[pair.label] + pair.offset) & 0xFF;
                    } else {
                        throw {error: "Undefined label: " + pair.label};
                    }
                }
            }

            return {code: memory, mapping: mapping, labels: labels};
        }
    };
}]);

/*
 * Local variables:
 * c-basic-offset: 4
 * tab-width: 4
 * indent-tabs-mode: nil
 * End:
 */
