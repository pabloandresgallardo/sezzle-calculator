import { useCallback, useEffect, useReducer, useRef, type Dispatch } from 'react';
import { DEFAULT_BACKEND, otherBackend, RECHECK_INTERVAL_MS, type Backend } from './backend';
import { checkHealth } from './checkHealth';

export interface UseBackends {
  /** Where the next calculation goes. */
  active: Backend;
  /** Both backends are healthy, so the user may choose. */
  selectable: boolean;
  /** The user's choice: kept until that backend fails. Not persisted. */
  select: (backend: Backend) => void;
  /**
   * Called after a calculation on `failed` (default: `active`) was unavailable: marks it down,
   * re-checks the other one and, when healthy, makes it active (as an automatic choice) and
   * returns it; otherwise `null`. `failed` matters because `active` may have changed (a late health
   * result) while that request was in flight.
   */
  failover: (failed?: Backend) => Promise<Backend | null>;
}

/** `null` until the first answer. */
type Health = Record<Backend, boolean | null>;

interface BackendsState {
  health: Health;
  active: Backend;
  /** `active` was picked by the user, not by a fallback or failover. */
  chosenByUser: boolean;
}

type BackendsAction =
  | { type: 'selected'; backend: Backend }
  | { type: 'checked'; health: Partial<Record<Backend, boolean>> };

const initialState: BackendsState = {
  health: { java: null, go: null },
  active: DEFAULT_BACKEND,
  chosenByUser: false,
};

/**
 * | java | go   | active                                        | selector |
 * |------|------|-----------------------------------------------|----------|
 * | up   | up   | the user's choice, else java                  | shown    |
 * | down | up   | go                                            | hidden   |
 * | up   | down | java                                          | hidden   |
 * | down | down | unchanged (java at start-up)                  | hidden   |
 */
function backendsReducer(state: BackendsState, action: BackendsAction): BackendsState {
  if (action.type === 'selected') {
    return { ...state, active: action.backend, chosenByUser: true };
  }
  const health: Health = { ...state.health, ...action.health };
  if (health.java === true && health.go === true) {
    // Recovered: an automatic switch silently returns to java; a user's choice is respected.
    return {
      health,
      active: state.chosenByUser ? state.active : DEFAULT_BACKEND,
      chosenByUser: state.chosenByUser,
    };
  }
  const other = otherBackend(state.active);
  if (health[state.active] === false && health[other] === true) {
    return { health, active: other, chosenByUser: false };
  }
  return { ...state, health };
}

/** Checks both in parallel and reports them together; results after `signal` aborts are dropped. */
function checkBoth(dispatch: Dispatch<BackendsAction>, signal: AbortSignal): void {
  void Promise.all([checkHealth('java', signal), checkHealth('go', signal)]).then(([java, go]) => {
    if (!signal.aborted) {
      dispatch({ type: 'checked', health: { java, go } });
    }
  });
}

export function useBackends(): UseBackends {
  const [state, dispatch] = useReducer(backendsReducer, initialState);
  const { health, active } = state;
  const degraded = health.java === false || health.go === false;

  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });

  useEffect(() => {
    const controller = new AbortController();
    checkBoth(dispatch, controller.signal);
    return () => {
      controller.abort();
    };
  }, []);

  // Polling only while one is down; cleared on recovery and on unmount.
  useEffect(() => {
    if (!degraded) {
      return;
    }
    const controller = new AbortController();
    const interval = setInterval(() => {
      checkBoth(dispatch, controller.signal);
    }, RECHECK_INTERVAL_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [degraded]);

  const select = useCallback((backend: Backend) => {
    dispatch({ type: 'selected', backend });
  }, []);

  const failover = useCallback(async (failed?: Backend): Promise<Backend | null> => {
    failed ??= activeRef.current;
    const other = otherBackend(failed);
    const otherHealthy = await checkHealth(other);
    const checked: Partial<Record<Backend, boolean>> = {};
    checked[failed] = false;
    checked[other] = otherHealthy;
    dispatch({ type: 'checked', health: checked });
    return otherHealthy ? other : null;
  }, []);

  return { active, selectable: health.java === true && health.go === true, select, failover };
}
