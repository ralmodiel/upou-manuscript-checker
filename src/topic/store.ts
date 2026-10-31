// Where the planner keeps its plans in this browser, and the one thing the page needs to know
// without opening the planner: how to forget them. (No imports: this is in the page's own chunk.)
export const PLANS_KEY = 'upou-topic-plans'
/** The single plan an earlier version saved; taken over on the next load, then removed. */
export const OLD_PLAN_KEY = 'upou-topic-plan'

/** Forgets every plan kept here: the page's last resort when a saved plan breaks the planner. */
export function clearPlans() {
  try {
    localStorage.removeItem(PLANS_KEY)
    localStorage.removeItem(OLD_PLAN_KEY)
  } catch {
    // Storage blocked: nothing was kept, then.
  }
}
