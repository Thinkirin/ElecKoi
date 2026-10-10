import { useCallback, useMemo } from "react";
import { TrajectoryView as ProductTrajectoryView, zh } from "@eleckoi/dsh-client-trajectory/client";
import { adaptTrajectorySnapshot } from "../model/trajectorySnapshotAdapter.js";

const noop = () => {};

export function TrajectoryView({ renderSlot, viewOwner }) {
  return <section className="trajectory-host" aria-label="轨迹">
    {renderSlot?.("eleckoi.roleplay.trajectory", {
      component: SessionTrajectoryView,
      inspectCall: undefined,
      viewRequest: null,
      openView: noop,
      completeViewRequest: noop,
      ...viewOwner,
    })}
  </section>;
}

export function SessionTrajectoryView(props) {
  const official = props.useTrajectory((value) => value);
  const outcomes = props.useProjection("eleckoiTurnOutcomes");
  const inputIdentities = props.useProjection("eleckoiInputContinuations");
  const snapshot = useMemo(
    () => adaptTrajectorySnapshot(official, outcomes, inputIdentities),
    [official, outcomes, inputIdentities],
  );
  const useTrajectory = useCallback((selector) => selector(snapshot), [snapshot]);
  const translate = useCallback((key, values = {}) => {
    let text = zh[key];
    if (!text) return props.t(key, values);
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  }, [props.t]);
  return <ProductTrajectoryView {...props} useTrajectory={useTrajectory} t={translate} />;
}
