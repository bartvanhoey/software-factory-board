"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createProjectAction, lookupBranchAction, saveProjectAction, setProjectArchivedAction, setProjectEnabledAction, type ProjectState } from "@/auth/project-actions";
import { errorField } from "@/auth/project-fields";
import { COMMAND_PRESETS, nameFromRepo, repoFromInput } from "./projectDefaults";

export interface ProjectValues {
  name: string;
  repo: string;
  defaultBranch: string;
  stack: string;
  lanes: { build: boolean; qa: boolean; review: boolean };
  limits: { maxTurns: number; qaMaxTurns: number; reviewMaxTurns: number; maxReworks: number };
  commands: { build?: string; test?: string };
  enabled: boolean;
  version: number;
}

export const NEW_PROJECT: ProjectValues = {
  name: "",
  repo: "",
  defaultBranch: "main",
  stack: "other",
  lanes: { build: true, qa: true, review: true },
  limits: { maxTurns: 20, qaMaxTurns: 20, reviewMaxTurns: 20, maxReworks: 2 },
  commands: {},
  enabled: false,
  version: 0,
};

/** The inputs that sit under "Advanced settings" when adding a project: an error about one of them opens that section. */
const ADVANCED_FIELDS = ["defaultBranch", "stack","maxTurns", "qaMaxTurns", "reviewMaxTurns", "maxReworks", "commandBuild", "commandTest"];

const input = "mt-1 block w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button = "rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 aria-disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800";

/** An action that returns an error resets an uncontrolled form, so what was typed comes back from the server. */
const typed = (state: ProjectState, name: string, initial: string | number): string => {
  const echoed = state.values?.[name];
  return echoed !== undefined ? echoed : String(initial);
};
const ticked = (state: ProjectState, name: string, initial: boolean): boolean => (state.values ? state.values[name] === "on" : initial);

function Feedback({ state, id }: { state: ProjectState; id?: string }) {
  if (state.error) {
    return (
      <p id={id} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
        {state.error}
      </p>
    );
  }
  return state.message ? (
    <p role="status" className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
      {state.message}
    </p>
  ) : null;
}

function Field({
  label,
  hint,
  name,
  invalid,
  errorId,
  children,
}: {
  label: string;
  hint?: string;
  /** The input's name, to match an error to it. */
  name: string;
  invalid: boolean;
  errorId: string;
  children: (props: { "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const hintId = useId();
  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <label className="block text-xs" data-field={name}>
      <span className="font-medium">{label}</span>
      {children({ "aria-describedby": describedBy, ...(invalid ? { "aria-invalid": true } : {}) })}
      {hint && (
        <span id={hintId} className="mt-0.5 block text-zinc-500 dark:text-zinc-400">
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * Add (mode "create") or edit (mode "edit") a project. The Administrator also gets the build and test commands and, when
 * adding, the switch; a Project manager's form has neither (the server refuses them from anyone else too). `locked` is a
 * Project manager looking at a project that is switched on: they cannot change it, so the form is read-only.
 */
export function ProjectForm({ mode, values, isAdmin, locked = false }: { mode: "create" | "edit"; values: ProjectValues; isAdmin: boolean; locked?: boolean }) {
  const [state, action, pending] = useActionState(mode === "create" ? createProjectAction : saveProjectAction, {});
  const editing = mode === "edit";
  const errorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const failing = errorField(state.error);

  // Adding a project asks for a repository, a name and a branch; the rest is under "Advanced settings". The name, the
  // branch and the commands are suggested from what was entered, and a suggestion never replaces what a person typed.
  const creating = !editing;
  const nameRef = useRef<HTMLInputElement>(null);
  const branchRef = useRef<HTMLInputElement>(null);
  const buildRef = useRef<HTMLInputElement>(null);
  const testRef = useRef<HTMLInputElement>(null);
  const typedBy = useRef({ name: false, branch: false, build: false, test: false });
  const lookupSeq = useRef(0);
  const [lookupNote, setLookupNote] = useState("");
  const [presetNote, setPresetNote] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedFailing = failing !== null && ADVANCED_FIELDS.includes(failing);

  // A project that was added leaves an empty form again, with nothing typed and no notes.
  useEffect(() => {
    if (!creating || !state.message) return;
    typedBy.current = { name: false, branch: false, build: false, test: false };
    setLookupNote("");
    setPresetNote("");
    setAdvancedOpen(false);
  }, [state, creating]);

  const suggestName = (repo: string) => {
    if (!typedBy.current.name && nameRef.current) nameRef.current.value = nameFromRepo(repo);
  };

  // The repository field lost focus: a pasted GitHub address becomes owner/name, the name follows from it, and the
  // branch is looked up.
  function repoEntered(field: HTMLInputElement) {
    const repo = repoFromInput(field.value);
    if (repo !== field.value) field.value = repo;
    suggestName(repo);
    void findBranch(repo);
  }

  async function findBranch(repo: string) {
    const value = repo.trim();
    if (typedBy.current.branch || !/^[^/\s]+\/[^/\s]+$/.test(value)) return;
    const seq = ++lookupSeq.current;
    setLookupNote("Looking up the default branch on GitHub…");
    const found: { branch?: string; error?: string } = await lookupBranchAction(value).catch(() => ({ error: "Could not look it up." }));
    if (seq !== lookupSeq.current) return; // another repository was entered while this one was being looked up
    if (found.branch) {
      // A branch typed while the lookup was running is the person's choice and stays.
      if (!typedBy.current.branch && branchRef.current) {
        branchRef.current.value = found.branch;
        setLookupNote(`Default branch read from GitHub: ${found.branch}.`);
      }
      return;
    }
    // The branch input is inside "Advanced settings": open it, so the reason and the branch that will be used are in view.
    setLookupNote(`${found.error ?? "Could not look it up."} Using ${branchRef.current?.value || "main"}; change it if that is wrong.`);
    setAdvancedOpen(true);
  }

  function suggestCommands(stack: string) {
    if (!isAdmin) return;
    const preset = COMMAND_PRESETS[stack];
    if (!typedBy.current.build && buildRef.current) buildRef.current.value = preset?.build ?? "";
    if (!typedBy.current.test && testRef.current) testRef.current.value = preset?.test ?? "";
    setPresetNote(preset ? "Suggested for this stack. Check them before you switch the project on." : "");
  }

  // After a failed save, move focus to the input the error is about (or, if it is about none, to the message), so a
  // keyboard or screen reader user lands on the problem instead of at the top of the page.
  useEffect(() => {
    if (!state.error) return;
    const target = failing ? formRef.current?.querySelector<HTMLElement>(`[name="${failing}"]`) : null;
    (target ?? alertRef.current)?.focus();
  }, [state, failing]);

  const field = (name: string) => ({ name, invalid: failing === name, errorId });
  const send = (e: React.FormEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>) => {
    if (pending) e.preventDefault(); // aria-disabled keeps focus on the button; this stops a second submit
  };

  const nameField = (
    <Field label="Name (required)" hint={editing ? "Cannot be changed." : "Lowercase letters, digits and dashes. Suggested from the repository."} {...field("name")}>
      {(a) =>
        editing ? (
          <>
            <input type="hidden" name="name" value={values.name} />
            <input className={input} value={values.name} readOnly {...a} />
          </>
        ) : (
          <input
            ref={nameRef}
            className={input}
            name="name"
            defaultValue={typed(state, "name", values.name)}
            onChange={() => (typedBy.current.name = true)}
            required
            maxLength={64}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lowercase letters, digits and dashes"
            autoComplete="off"
            {...a}
          />
        )
      }
    </Field>
  );
  const repoField = (
    <Field label="GitHub repository (required)" hint="owner/name" {...field("repo")}>
      {(a) => (
        <input
          className={input}
          name="repo"
          defaultValue={typed(state, "repo", values.repo)}
          onChange={creating ? (e) => suggestName(repoFromInput(e.currentTarget.value)) : undefined}
          onBlur={creating ? (e) => repoEntered(e.currentTarget) : undefined}
          required
          maxLength={200}
          pattern="[A-Za-z0-9][A-Za-z0-9\-]*/[A-Za-z0-9_][A-Za-z0-9._\-]*"
          title="owner/name, as on GitHub"
          autoComplete="off"
          {...a}
        />
      )}
    </Field>
  );
  const branchField = (
    <Field label="Default branch" hint={creating ? lookupNote || "Looked up on GitHub when you enter the repository." : undefined} {...field("defaultBranch")}>
      {(a) => (
        <input
          ref={branchRef}
          className={input}
          name="defaultBranch"
          defaultValue={typed(state, "defaultBranch", values.defaultBranch)}
          onChange={() => (typedBy.current.branch = true)}
          maxLength={100}
          autoComplete="off"
          {...a}
        />
      )}
    </Field>
  );
  const stackField = (
    <Field label="Stack" {...field("stack")}>
      {(a) => (
        <select className={input} name="stack" defaultValue={typed(state, "stack", values.stack)} onChange={creating ? (e) => suggestCommands(e.currentTarget.value) : undefined} {...a}>
          {["dotnet", "node", "python", "other"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
    </Field>
  );
  // Adding: the two things that matter, then the rest folded away. Editing: everything, as before.
  const advanced = (rest: ReactNode) =>
    creating ? (
      <details open={advancedOpen || advancedFailing} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium hover:underline">
          Advanced settings <span className="font-normal text-zinc-500 dark:text-zinc-400">(the defaults suit most projects)</span>
        </summary>
        <div className="mt-3 space-y-3">
          {branchField}
          {stackField}
          {rest}
        </div>
      </details>
    ) : (
      rest
    );

  return (
    <form ref={formRef} action={action} className="space-y-3">
      {editing && <input type="hidden" name="version" value={values.version} />}
      {locked && <p className="text-xs text-zinc-600 dark:text-zinc-400">This project is switched on, so only an Administrator can change it. Switch it off first to edit it.</p>}
      <fieldset disabled={locked} className="space-y-3">
        <legend className="sr-only">{editing ? `Settings of ${values.name}` : "New project"}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {creating ? (
            <>
              {repoField}
              {nameField}
              {/* The branch and its note change without anyone typing there, so say so to a screen reader too. */}
              <p role="status" className="sr-only">
                {lookupNote}
              </p>
            </>
          ) : (
            <>
              {nameField}
              {repoField}
              {branchField}
              {stackField}
            </>
          )}
        </div>

        {advanced(<>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="mb-1 text-xs font-medium">Lanes that run for this project</legend>
          {([["laneBuild", "build", values.lanes.build], ["laneQa", "qa", values.lanes.qa], ["laneReview", "review", values.lanes.review]] as const).map(([name, label, on]) => (
            <label key={name} className="flex items-center gap-1 text-xs">
              <input type="checkbox" name={name} defaultChecked={ticked(state, name, on)} />
              {label}
            </label>
          ))}
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <legend className="mb-1 text-xs font-medium">Limits</legend>
          <Field label="Build turns" hint="1 to 100" {...field("maxTurns")}>
            {(a) => <input className={input} type="number" name="maxTurns" min={1} max={100} defaultValue={typed(state, "maxTurns", values.limits.maxTurns)} {...a} />}
          </Field>
          <Field label="QA turns" hint="1 to 100" {...field("qaMaxTurns")}>
            {(a) => <input className={input} type="number" name="qaMaxTurns" min={1} max={100} defaultValue={typed(state, "qaMaxTurns", values.limits.qaMaxTurns)} {...a} />}
          </Field>
          <Field label="Review turns" hint="1 to 100" {...field("reviewMaxTurns")}>
            {(a) => <input className={input} type="number" name="reviewMaxTurns" min={1} max={100} defaultValue={typed(state, "reviewMaxTurns", values.limits.reviewMaxTurns)} {...a} />}
          </Field>
          <Field label="Automatic reworks" hint="0 to 5" {...field("maxReworks")}>
            {(a) => <input className={input} type="number" name="maxReworks" min={0} max={5} defaultValue={typed(state, "maxReworks", values.limits.maxReworks)} {...a} />}
          </Field>
        </fieldset>

        {isAdmin ? (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1 text-xs font-medium">Commands (run in the runner container)</legend>
            <Field label="Build command" hint="One line. Used when there is no test command." {...field("commandBuild")}>
              {(a) => <input ref={buildRef} className={`${input} font-mono`} name="commandBuild" defaultValue={typed(state, "commandBuild", values.commands.build ?? "")} onChange={() => (typedBy.current.build = true)} maxLength={500} autoComplete="off" {...a} />}
            </Field>
            <Field label="Test command" hint="One line. Leave empty for a project without tests." {...field("commandTest")}>
              {(a) => <input ref={testRef} className={`${input} font-mono`} name="commandTest" defaultValue={typed(state, "commandTest", values.commands.test ?? "")} onChange={() => (typedBy.current.test = true)} maxLength={500} autoComplete="off" {...a} />}
            </Field>
            {presetNote && (
              <p role="status" className="text-xs text-zinc-500 sm:col-span-2 dark:text-zinc-400">
                {presetNote}
              </p>
            )}
          </fieldset>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">An Administrator sets the build and test commands and switches the project on.</p>
        )}

        {isAdmin && !editing && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="enabled" defaultChecked={ticked(state, "enabled", false)} />
            Switch it on now
          </label>
        )}
        </>)}
      </fieldset>

      {!locked && (
        <button type="submit" aria-disabled={pending} onClick={send} className={button}>
          {pending ? "Saving…" : editing ? "Save" : "Add project"}
        </button>
      )}
      {state.error ? (
        <p id={errorId} ref={alertRef} tabIndex={-1} role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          {state.error}
        </p>
      ) : (
        <Feedback state={state} />
      )}
    </form>
  );
}

/** Archives a switched-off project, or restores an archived one. Administrator only; the page does not render it for anyone else. */
export function ArchiveButton({ name, archived, version }: { name: string; archived: boolean; version: number }) {
  const [state, action, pending] = useActionState(setProjectArchivedAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="archived" value={archived ? "false" : "true"} />
      <button type="submit" aria-disabled={pending} onClick={(e) => pending && e.preventDefault()} className={button}>
        {archived ? "Restore" : "Archive"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function EnableButton({ name, enabled, version, isAdmin }: { name: string; enabled: boolean; version: number; isAdmin: boolean }) {
  const [state, action, pending] = useActionState(setProjectEnabledAction, {});
  const status = useRef<HTMLParagraphElement>(null);
  // Switching on is the Administrator's decision; a Project manager can only switch off.
  const waiting = !enabled && !isAdmin;

  // A Project manager's "Switch off" replaces its own button with "Waiting for an Administrator" once it works. The
  // focused button is gone then, so focus moves to the confirmation instead of falling back to the top of the page.
  useEffect(() => {
    if (waiting && state.message) status.current?.focus();
  }, [waiting, state]);

  if (waiting) {
    return (
      <div className="text-xs text-zinc-500 dark:text-zinc-400">
        <span>Waiting for an Administrator</span>
        <p ref={status} tabIndex={-1} role="status" className="mt-1 text-zinc-600 dark:text-zinc-400">
          {state.message}
        </p>
      </div>
    );
  }
  return (
    <form action={action}>
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <button type="submit" aria-disabled={pending} onClick={(e) => pending && e.preventDefault()} className={button}>
        {enabled ? "Switch off" : "Switch on"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
