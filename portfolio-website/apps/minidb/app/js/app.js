/*
 * MiniDB demo terminal — wires the ported engine (engine.js) to a
 * retro terminal UI and a side panel exposing the raw log + live
 * index, so a visitor can watch the append-only log grow and see
 * `compact` actually shrink it.
 */

(function () {
  "use strict";

  var db = new window.MiniDB();

  var outputEl = document.getElementById("output");
  var formEl = document.getElementById("input-form");
  var inputEl = document.getElementById("input");
  var terminalEl = document.getElementById("terminal");

  var statCount = document.getElementById("stat-count");
  var statBytes = document.getElementById("stat-bytes");
  var statRecords = document.getElementById("stat-records");
  var indexBody = document.getElementById("index-body");
  var logBody = document.getElementById("log-body");

  var HELP_TEXT = [
    "Commands:",
    "  set <key> <value...>   Store <value...> (rest of the line) under <key>",
    "  get <key>              Print the value stored under <key>",
    "  del <key>               Delete <key>",
    "  keys                    List all live keys, one per line",
    "  compact                 Rewrite the log, dropping stale/deleted entries",
    "  reload                  Rebuild the index by replaying the log from byte 0",
    "  stats                   Show key count, log size, and record count",
    "  clear                   Clear this terminal's scrollback",
    "  help                    Show this message",
    "",
    "The panel on the right mirrors the engine's real internal state as you go.",
  ];

  // -----------------------------------------------------------------
  // output helpers
  // -----------------------------------------------------------------

  function appendLine(text, cls) {
    var line = document.createElement("div");
    line.className = "line" + (cls ? " " + cls : "");
    line.textContent = text;
    outputEl.appendChild(line);
    outputEl.scrollTop = outputEl.scrollHeight;
    return line;
  }

  function appendPromptLine(cmdText) {
    var line = document.createElement("div");
    line.className = "line line-prompt";
    var sym = document.createElement("span");
    sym.className = "sym";
    sym.textContent = "minidb> ";
    line.appendChild(sym);
    line.appendChild(document.createTextNode(cmdText));
    outputEl.appendChild(line);
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  // -----------------------------------------------------------------
  // command parsing — mirrors Python's `line.split(maxsplit=2)` so
  // `set <key> <value with spaces>` behaves like the real CLI
  // -----------------------------------------------------------------

  function splitCommand(line) {
    var parts = [];
    var rest = line;
    for (var i = 0; i < 2; i++) {
      rest = rest.replace(/^\s+/, "");
      var m = rest.match(/\s/);
      if (!m) {
        if (rest) parts.push(rest);
        rest = "";
        break;
      }
      var idx = rest.search(/\s/);
      parts.push(rest.slice(0, idx));
      rest = rest.slice(idx);
    }
    rest = rest.trim();
    if (rest) parts.push(rest);
    return parts;
  }

  // -----------------------------------------------------------------
  // panel rendering
  // -----------------------------------------------------------------

  function opName(op) {
    return op === window.MINIDB_OP_DEL ? "DEL" : "SET";
  }

  function renderPanels() {
    statCount.textContent = String(db.count);
    statBytes.textContent = String(db.sizeBytes);
    statRecords.textContent = String(db.records.length);

    // live index
    indexBody.innerHTML = "";
    var keys = db.keys();
    if (keys.length === 0) {
      var emptyRow = document.createElement("tr");
      var emptyCell = document.createElement("td");
      emptyCell.colSpan = 2;
      emptyCell.className = "empty";
      emptyCell.textContent = "(empty — nothing set yet)";
      emptyRow.appendChild(emptyCell);
      indexBody.appendChild(emptyRow);
    } else {
      keys.forEach(function (key) {
        var tr = document.createElement("tr");
        var keyTd = document.createElement("td");
        keyTd.textContent = key;
        var valTd = document.createElement("td");
        valTd.className = "val";
        try {
          valTd.textContent = db.get(key);
        } catch (e) {
          valTd.textContent = "?";
        }
        tr.appendChild(keyTd);
        tr.appendChild(valTd);
        indexBody.appendChild(tr);
      });
    }

    // raw log
    logBody.innerHTML = "";
    if (db.records.length === 0) {
      var emptyLogRow = document.createElement("tr");
      var emptyLogCell = document.createElement("td");
      emptyLogCell.colSpan = 5;
      emptyLogCell.className = "empty";
      emptyLogCell.textContent = "(log is empty)";
      emptyLogRow.appendChild(emptyLogCell);
      logBody.appendChild(emptyLogRow);
    } else {
      db.records.forEach(function (rec, i) {
        var tr = document.createElement("tr");
        tr.className = rec.op === window.MINIDB_OP_DEL ? "op-del" : "op-set";

        var idxTd = document.createElement("td");
        idxTd.textContent = String(i);
        var offTd = document.createElement("td");
        offTd.textContent = String(rec.offset);
        var opTd = document.createElement("td");
        opTd.className = "op";
        opTd.textContent = opName(rec.op);
        var keyTd = document.createElement("td");
        keyTd.className = "key";
        keyTd.textContent = rec.key;
        var lenTd = document.createElement("td");
        lenTd.textContent = String(rec.valueLen);

        tr.appendChild(idxTd);
        tr.appendChild(offTd);
        tr.appendChild(opTd);
        tr.appendChild(keyTd);
        tr.appendChild(lenTd);
        logBody.appendChild(tr);
      });
    }

    // keep the raw-log scroll pinned to the newest record
    var wrap = logBody.closest(".log-table-wrap");
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  // -----------------------------------------------------------------
  // command execution — same vocabulary/output style as minidb/cli.py
  // -----------------------------------------------------------------

  function runCommand(rawLine) {
    var line = rawLine.trim();
    if (!line) return;

    var parts = splitCommand(line);
    var cmd = parts[0].toLowerCase();

    try {
      switch (cmd) {
        case "help":
          HELP_TEXT.forEach(function (t) {
            appendLine(t);
          });
          break;

        case "set":
          if (parts.length < 3) {
            appendLine("usage: set <key> <value>", "line-muted");
            break;
          }
          db.set(parts[1], parts[2]);
          appendLine("OK", "line-ok");
          break;

        case "get":
          if (parts.length < 2) {
            appendLine("usage: get <key>", "line-muted");
            break;
          }
          appendLine(db.get(parts[1]));
          break;

        case "del":
        case "delete":
          if (parts.length < 2) {
            appendLine("usage: del <key>", "line-muted");
            break;
          }
          db.delete(parts[1]);
          appendLine("OK", "line-ok");
          break;

        case "keys":
          var keys = db.keys();
          if (keys.length === 0) {
            appendLine("(no keys)", "line-muted");
          } else {
            keys.forEach(function (k) {
              appendLine(k);
            });
          }
          break;

        case "compact":
          var before = db.sizeBytes;
          db.compact();
          var after = db.sizeBytes;
          appendLine("compacted: " + before + " bytes -> " + after + " bytes", "line-ok");
          break;

        case "reload":
          db.reload();
          appendLine(
            "index rebuilt from log: " + db.count + " live key(s) (" + db.records.length + " record(s) replayed)",
            "line-ok"
          );
          break;

        case "stats":
          appendLine("keys:    " + db.count);
          appendLine("bytes:   " + db.sizeBytes);
          appendLine("records: " + db.records.length);
          break;

        case "clear":
          outputEl.innerHTML = "";
          break;

        case "exit":
        case "quit":
          appendLine("this is a browser demo — close the tab (or keep poking at it!)", "line-muted");
          break;

        default:
          appendLine("unknown command: '" + parts[0] + "' (type 'help' for a list)", "line-muted");
      }
    } catch (err) {
      appendLine("error: " + err.message, "line-error");
    }

    renderPanels();
  }

  function submitFromUser(line) {
    appendPromptLine(line);
    runCommand(line);
  }

  // -----------------------------------------------------------------
  // welcome banner + seeded example session
  // -----------------------------------------------------------------

  function seed() {
    [
      "MiniDB — an append-only, log-structured key-value store.",
      "Ported line-for-line from the real Python engine to run live, client-side, right here.",
      "Every command below runs against the real engine — nothing is faked.",
      "Type 'help' for commands. Here's a quick tour:",
      "",
    ].forEach(function (t) {
      appendLine(t, "line-banner");
    });

    [
      "set user:1 alice",
      "set user:2 bob",
      "set user:1 alice-updated",
      "get user:1",
      "keys",
      "del user:2",
      "compact",
      "stats",
    ].forEach(function (cmdLine) {
      appendPromptLine(cmdLine);
      runCommand(cmdLine);
    });

    appendLine("", "");
    appendLine("Ready — try 'set', 'get', 'del', 'keys', 'compact', 'reload', or 'help'.", "line-banner");
  }

  // -----------------------------------------------------------------
  // wiring
  // -----------------------------------------------------------------

  var history = [];
  var historyIndex = -1;

  formEl.addEventListener("submit", function (e) {
    e.preventDefault();
    var line = inputEl.value;
    if (!line.trim()) return;
    history.push(line);
    historyIndex = history.length;
    inputEl.value = "";
    submitFromUser(line);
  });

  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      inputEl.value = history[historyIndex] || "";
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    } else if (e.key === "ArrowDown") {
      if (history.length === 0) return;
      e.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      inputEl.value = history[historyIndex] || "";
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    }
  });

  terminalEl.addEventListener("click", function () {
    inputEl.focus();
  });

  seed();
  renderPanels();
  inputEl.focus();
})();
