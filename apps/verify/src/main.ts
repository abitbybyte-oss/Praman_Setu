import { verifyBundle, type Check, type KeyRegistry, type VerifyReport } from "@fdtc/evidence-core";

/** verify.html is only a UI. Every rule lives in evidence-core, which the app,
 * the mock server and this page all share (ARCHITECTURE §11).
 *
 * Everything loaded here is untrusted input, so nothing from a file is ever
 * written as HTML — only ever as text. */

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
};

const recordInput = $<HTMLInputElement>("record");
const imagesInput = $<HTMLInputElement>("images");
const registryFileInput = $<HTMLInputElement>("registryFile");
const registryUrlInput = $<HTMLInputElement>("registryUrl");
const registryStatus = $<HTMLParagraphElement>("registryStatus");
const fetchRegistryButton = $<HTMLButtonElement>("fetchRegistry");
const verifyButton = $<HTMLButtonElement>("verify");
const results = $<HTMLDivElement>("results");

let bundle: unknown = null;
let registry: KeyRegistry | null = null;

async function readJsonFile(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

function setRegistryStatus(message: string, tone: "muted" | "pass" | "fail" = "muted"): void {
  registryStatus.textContent = message;
  registryStatus.style.color =
    tone === "pass" ? "var(--pass)" : tone === "fail" ? "var(--fail)" : "var(--muted)";
}

function describeRegistry(loaded: KeyRegistry, source: string): void {
  const count = loaded.keys?.length ?? 0;
  setRegistryStatus(
    `Loaded ${count} registered device key${count === 1 ? "" : "s"} from ${source}.`,
    "pass"
  );
}

recordInput.addEventListener("change", async () => {
  const file = recordInput.files?.[0];
  if (!file) {
    bundle = null;
    verifyButton.disabled = true;
    return;
  }
  try {
    bundle = await readJsonFile(file);
    verifyButton.disabled = false;
  } catch {
    bundle = null;
    verifyButton.disabled = true;
    renderError("That file is not readable JSON, so it cannot be a valid evidence record.");
  }
});

registryFileInput.addEventListener("change", async () => {
  const file = registryFileInput.files?.[0];
  if (!file) return;
  try {
    registry = (await readJsonFile(file)) as KeyRegistry;
    describeRegistry(registry, file.name);
  } catch {
    registry = null;
    setRegistryStatus("That registry file is not readable JSON.", "fail");
  }
});

fetchRegistryButton.addEventListener("click", async () => {
  let url = registryUrlInput.value.trim();
  if (url && !/\/v1\/registry\/?$/.test(url)) url = `${url.replace(/\/+$/, "")}/v1/registry`;
  if (!url) {
    setRegistryStatus("Enter the agency server's registry URL first.", "fail");
    return;
  }
  fetchRegistryButton.disabled = true;
  setRegistryStatus("Fetching…");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`server replied ${response.status}`);
    registry = (await response.json()) as KeyRegistry;
    describeRegistry(registry, url);
  } catch (error) {
    registry = null;
    setRegistryStatus(
      `Could not fetch the registry: ${error instanceof Error ? error.message : "unknown error"}. You can load a saved registry file instead.`,
      "fail"
    );
  } finally {
    fetchRegistryButton.disabled = false;
  }
});

verifyButton.addEventListener("click", async () => {
  if (!bundle) return;
  verifyButton.disabled = true;
  try {
    const files = Array.from(imagesInput.files ?? []);
    const images = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }))
    );
    render(verifyBundle({ bundle, registry, images }));
  } finally {
    verifyButton.disabled = false;
  }
});

const VERDICT_COPY: Record<VerifyReport["verdict"], { className: string; title: string; text: string }> = {
  VERIFIED: {
    className: "verdict v-pass",
    title: "VERIFIED",
    text: "This record is exactly as it was when the device signed it, and the signing device is registered with the agency.",
  },
  VERIFIED_WITH_WARNINGS: {
    className: "verdict v-warn",
    title: "VERIFIED WITH WARNINGS",
    text: "Nothing in this record has been altered, but some checks could not be completed. See the details below.",
  },
  FAILED: {
    className: "verdict v-fail",
    title: "FAILED",
    text: "This record did not pass verification. It must not be relied upon. See the details below.",
  },
};

function renderError(message: string): void {
  results.classList.remove("hidden");
  const verdict = $<HTMLDivElement>("verdict");
  verdict.className = "verdict v-fail";
  $("verdictTitle").textContent = "FAILED";
  $("verdictText").textContent = message;
  $("checks").replaceChildren();
  $("recordTable").replaceChildren();
}

function renderCheck(check: Check): HTMLLIElement {
  const item = document.createElement("li");

  const badge = document.createElement("span");
  badge.className = `badge b-${check.status}`;
  badge.textContent = check.status === "SKIPPED" ? "NOT RUN" : check.status;

  const body = document.createElement("div");
  const label = document.createElement("div");
  label.className = "check-label";
  label.textContent = check.label;
  const detail = document.createElement("div");
  detail.className = "check-detail";
  detail.textContent = check.detail;
  body.append(label, detail);

  item.append(badge, body);
  return item;
}

function renderRecords(report: VerifyReport): HTMLTableSectionElement {
  const body = document.createElement("tbody");

  const header = document.createElement("tr");
  for (const heading of ["Seq", "Type", "Created", "Record hash"]) {
    const th = document.createElement("th");
    th.textContent = heading;
    header.append(th);
  }
  body.append(header);

  for (const record of report.records) {
    const row = document.createElement("tr");
    const cells = [
      record.seq === null ? "—" : String(record.seq),
      record.record_type ?? "—",
      record.created_at ?? "—",
    ];
    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      row.append(td);
    }
    const hashCell = document.createElement("td");
    const hash = document.createElement("code");
    hash.textContent = record.record_hash;
    hashCell.append(hash);
    row.append(hashCell);
    body.append(row);
  }

  return body;
}

function render(report: VerifyReport): void {
  results.classList.remove("hidden");

  const copy = VERDICT_COPY[report.verdict];
  $<HTMLDivElement>("verdict").className = copy.className;
  $("verdictTitle").textContent = copy.title;
  $("verdictText").textContent = copy.text;

  $("checks").replaceChildren(...report.checks.map(renderCheck));
  $("recordTable").replaceChildren(renderRecords(report));

  results.scrollIntoView({ behavior: "smooth", block: "start" });
}
