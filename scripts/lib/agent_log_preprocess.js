// Pure helpers for cleaning terminal agent logs before speech / LLM rewrite.

function normalizeForSpeech(text) {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0008/g, '')
    .replace(/[\u0000-\u0007\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\t+/g, ' ');
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function splitForSpeech(text, maxLength) {
  const words = text.split(/\s+/);
  const chunks = [];
  let current = '';

  for (const word of words) {
    if (!word) {
      continue;
    }

    if (word.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }

      for (let index = 0; index < word.length; index += maxLength) {
        chunks.push(word.slice(index, index + maxLength));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function letterOrDigitOrCjkCount(text) {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (!code) {
      continue;
    }
    if (char >= 'a' && char <= 'z') {
      count += 1;
      continue;
    }
    if (char >= 'A' && char <= 'Z') {
      count += 1;
      continue;
    }
    if (char >= '0' && char <= '9') {
      count += 1;
      continue;
    }
    if (
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0x3400 && code <= 0x9fff) ||
      (code >= 0xff66 && code <= 0xff9f)
    ) {
      count += 1;
    }
  }
  return count;
}

function countDecorativeSymbols(text) {
  let count = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (!code) {
      continue;
    }
    if (char === '│' || char === '─' || char === '╭' || char === '╮' || char === '╯' || char === '╰') {
      count += 1;
      continue;
    }
    if (code >= 0x2500 && code <= 0x257f) {
      count += 1;
      continue;
    }
    if (code >= 0x2580 && code <= 0x259f) {
      count += 1;
      continue;
    }
    if (char === '▶' || char === '⏳' || char === '↓' || char === '→' || char === '⚠') {
      count += 1;
    }
  }
  return count;
}

function isDecorativeLine(line) {
  const collapsed = collapseWhitespace(line);
  if (!collapsed) {
    return true;
  }

  const substantive = letterOrDigitOrCjkCount(collapsed);
  if (substantive >= 8) {
    return false;
  }

  if (/^[▀▄\s]+$/.test(collapsed)) {
    return true;
  }

  const decorative = countDecorativeSymbols(collapsed);
  const ratio = decorative / Math.max(collapsed.replace(/\s/g, '').length, 1);
  if (substantive < 4 && ratio >= 0.35) {
    return true;
  }

  if (substantive < 6 && ratio >= 0.55) {
    return true;
  }

  return false;
}

function collapseConsecutiveDuplicates(lines) {
  const output = [];
  for (const line of lines) {
    if (output.length === 0 || output[output.length - 1] !== line) {
      output.push(line);
    }
  }
  return output;
}

function refineMeaningfulLines(lines) {
  const trimmed = lines.map((line) => collapseWhitespace(line)).filter((line) => line.length > 0);
  const filtered = trimmed.filter((line) => !isDecorativeLine(line));
  return collapseConsecutiveDuplicates(filtered);
}

function appendSnapshotTail(snapshot, addition, maxChars) {
  const chunk = typeof addition === 'string' ? addition : addition.join('\n');
  if (!chunk) {
    return snapshot || '';
  }

  let combined = snapshot ? `${snapshot}\n${chunk}` : chunk;
  if (combined.length <= maxChars) {
    return combined;
  }

  return combined.slice(-maxChars);
}

function processIncrementalChunk(rawCarry, lastMeaningfulLine, chunk) {
  const normalized = normalizeForSpeech(rawCarry + chunk);
  const lines = normalized.split('\n');
  const newCarry = lines.pop() || '';

  const meaningful = [];
  let last = lastMeaningfulLine;

  for (const line of lines) {
    const collapsed = collapseWhitespace(line);
    if (!collapsed) {
      continue;
    }
    if (isDecorativeLine(collapsed)) {
      continue;
    }
    if (collapsed === last) {
      continue;
    }
    meaningful.push(collapsed);
    last = collapsed;
  }

  return {
    carry: newCarry,
    lines: meaningful,
    lastMeaningfulLine: last,
  };
}

function flushCarryIfLong(rawCarry, maxCarryChars) {
  if (!rawCarry || rawCarry.length < maxCarryChars) {
    return { carry: rawCarry, flushed: [] };
  }

  const collapsed = collapseWhitespace(rawCarry);
  const flushed = collapsed ? [collapsed] : [];
  return { carry: '', flushed };
}

module.exports = {
  normalizeForSpeech,
  collapseWhitespace,
  splitForSpeech,
  isDecorativeLine,
  refineMeaningfulLines,
  collapseConsecutiveDuplicates,
  appendSnapshotTail,
  processIncrementalChunk,
  flushCarryIfLong,
};
