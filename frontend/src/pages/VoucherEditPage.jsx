import { useParams } from 'react-router-dom';
import { VoucherEntryForm } from '../features/vouchers/VoucherEntryForm';

export function VoucherEditPage() {
  const { voucherId = '' } = useParams();
  return <VoucherEntryForm voucherId={voucherId} />;
}
