import { useReducer } from "react";

const MAX_HISTORY = 50;

type Updater<T> = T | null | ((prev: T | null) => T | null);

interface HistoryState<T> {
  past: T[];
  present: T | null;
  future: T[];
}

type HistoryAction<T> =
  | { type: "set"; updater: Updater<T> }
  | { type: "set_silent"; updater: Updater<T> }
  | { type: "push_snapshot"; snapshot: T }
  | { type: "reset"; next: T | null }
  | { type: "undo" }
  | { type: "redo" };

function applyUpdater<T>(updater: Updater<T>, current: T | null): T | null {
  return typeof updater === "function"
    ? (updater as (p: T | null) => T | null)(current)
    : updater;
}

function reducer<T>(state: HistoryState<T>, action: HistoryAction<T>): HistoryState<T> {
  switch (action.type) {
    case "set": {
      const next = applyUpdater(action.updater, state.present);
      if (next === state.present) return state;
      const newPast =
        state.present !== null
          ? [...state.past, state.present].slice(-MAX_HISTORY)
          : state.past;
      return { past: newPast, present: next, future: [] };
    }
    case "set_silent": {
      // Update present without touching past; clears redo since a new edit branch started
      const next = applyUpdater(action.updater, state.present);
      if (next === state.present) return state;
      return { past: state.past, present: next, future: [] };
    }
    case "push_snapshot": {
      // Pushes a saved pre-change snapshot to past; present stays as-is
      return {
        past: [...state.past, action.snapshot].slice(-MAX_HISTORY),
        present: state.present,
        future: state.future,
      };
    }
    case "reset":
      return { past: [], present: action.next, future: [] };
    case "undo": {
      if (state.past.length === 0) return state;
      const past = [...state.past];
      const prev = past.pop()!;
      const future =
        state.present !== null
          ? [state.present, ...state.future]
          : state.future;
      return { past, present: prev, future };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const [next, ...future] = state.future;
      const past =
        state.present !== null
          ? [...state.past, state.present]
          : state.past;
      return { past, present: next, future };
    }
  }
}

export function useHistory<T>(initial: T | null = null) {
  const [state, dispatch] = useReducer(
    reducer as (s: HistoryState<T>, a: HistoryAction<T>) => HistoryState<T>,
    { past: [], present: initial, future: [] }
  );

  function setProject(updater: Updater<T>) {
    dispatch({ type: "set", updater });
  }

  function setProjectSilent(updater: Updater<T>) {
    dispatch({ type: "set_silent", updater });
  }

  function pushSnapshot(snapshot: T) {
    dispatch({ type: "push_snapshot", snapshot });
  }

  function resetProject(next: T | null) {
    dispatch({ type: "reset", next });
  }

  function undo() {
    dispatch({ type: "undo" });
  }

  function redo() {
    dispatch({ type: "redo" });
  }

  return {
    project: state.present,
    setProject,
    setProjectSilent,
    pushSnapshot,
    resetProject,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
