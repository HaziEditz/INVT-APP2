/** Inline Current Trip trace — what the driver app checked and decided. */

export type ActiveTripDiag = {
  at: string;
  phase: string;
  companyId: string;
  vehicleId: string;
  driverId: string;
  storageJobId: string;
  activeJobId: string;
  activeJobStage: string;
  hailActive: boolean;
  hasCurrentUi: boolean;
  allbookingsPath: string;
  allbookingsStatus: string;
  jobsPath: string;
  onlineCurrentJobId: string;
  serverRefresh: string;
  pickupVerifiedAt: string;
  uiBranch: string;
  decision: string;
};

export function emptyActiveTripDiag(): ActiveTripDiag {
  return {
    at: new Date().toISOString(),
    phase: "boot",
    companyId: "—",
    vehicleId: "—",
    driverId: "—",
    storageJobId: "—",
    activeJobId: "—",
    activeJobStage: "—",
    hailActive: false,
    hasCurrentUi: false,
    allbookingsPath: "—",
    allbookingsStatus: "—",
    jobsPath: "—",
    onlineCurrentJobId: "—",
    serverRefresh: "—",
    pickupVerifiedAt: "—",
    uiBranch: "—",
    decision: "starting…",
  };
}
