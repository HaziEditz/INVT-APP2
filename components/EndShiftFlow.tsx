import { EndShiftOverlay } from '@/components/EndShiftOverlay';
import { EndShiftSummaryModal } from '@/components/EndShiftSummaryModal';
import { useDriver } from '@/context/DriverContext';

export function EndShiftFlow() {
  const { endShiftInProgress, endShiftSummary, acknowledgeEndShiftSummary } = useDriver();

  return (
    <>
      <EndShiftOverlay visible={endShiftInProgress && !endShiftSummary} />
      <EndShiftSummaryModal
        visible={!!endShiftSummary}
        summary={endShiftSummary}
        onContinue={acknowledgeEndShiftSummary}
      />
    </>
  );
}
