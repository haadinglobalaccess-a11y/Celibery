import { describe, expect, it } from 'vitest';
import { canTransition, decideReconciliation, derivedPaymentStatus, outcomeForGatewayError, refundableBalance, validateRefundAmount } from '../../src/modules/payments/refund-state';
import { GatewayError } from '../../src/integrations/payments/http';

describe('refund lifecycle rules', () => {
  it('only allows the documented transitions', () => {
    expect(canTransition('requested', 'reserved')).toBe(true);
    expect(canTransition('reserved', 'processing')).toBe(true);
    expect(canTransition('processing', 'succeeded')).toBe(true);
    expect(canTransition('processing', 'reconciliation_required')).toBe(true);
    expect(canTransition('reconciliation_required', 'succeeded')).toBe(true);
    expect(canTransition('succeeded', 'failed')).toBe(false);
    expect(canTransition('failed', 'succeeded')).toBe(false);
    expect(canTransition('requested', 'succeeded')).toBe(false);
  });

  it('counts in-flight reservations against the refundable balance', () => {
    const o = { total: 13800, refundedAmount: 5000, refundReservedAmount: 4000 };
    expect(refundableBalance(o)).toBe(4800);
    expect(validateRefundAmount(4800, o)).toBeNull();
    expect(validateRefundAmount(4801, o)).toBe('REFUND_TOO_LARGE');
    expect(validateRefundAmount(0, o)).toBe('INVALID_AMOUNT');
    expect(validateRefundAmount(1.5, o)).toBe('INVALID_AMOUNT');
  });

  it('never releases a reservation after an uncertain gateway outcome', () => {
    expect(outcomeForGatewayError(new GatewayError('X', 400, true, 'bad amount'))).toBe('failed');
    expect(outcomeForGatewayError(new GatewayError('X', 502, false, 'bad gateway'))).toBe('reconciliation_required');
    expect(outcomeForGatewayError(new GatewayError('X', null, false, 'timeout'))).toBe('reconciliation_required');
    expect(outcomeForGatewayError(new Error('database down'))).toBe('reconciliation_required');
  });

  it('reconciles by matching the gateway total — and refuses to guess', () => {
    const open = [
      { id: 'a', amount: 1000 },
      { id: 'b', amount: 2500 },
    ];
    expect(decideReconciliation({ gatewayRefunded: 5000, confirmedRefunded: 5000, unresolved: open })).toMatchObject({ succeeded: [], failed: ['a', 'b'], manual: [] });
    expect(decideReconciliation({ gatewayRefunded: 8500, confirmedRefunded: 5000, unresolved: open })).toMatchObject({ succeeded: ['a', 'b'], failed: [], manual: [] });
    expect(decideReconciliation({ gatewayRefunded: 7500, confirmedRefunded: 5000, unresolved: open })).toMatchObject({ succeeded: ['b'], failed: ['a'], manual: [] });
    // Unexplained amount → manual
    expect(decideReconciliation({ gatewayRefunded: 5700, confirmedRefunded: 5000, unresolved: open }).manual).toEqual(['a', 'b']);
    // Gateway shows LESS than our ledger → manual
    expect(decideReconciliation({ gatewayRefunded: 1000, confirmedRefunded: 5000, unresolved: open }).manual).toEqual(['a', 'b']);
    // Ambiguous: two equal amounts, only one refunded → manual
    const twins = [
      { id: 'x', amount: 1000 },
      { id: 'y', amount: 1000 },
    ];
    expect(decideReconciliation({ gatewayRefunded: 1000, confirmedRefunded: 0, unresolved: twins }).manual).toEqual(['x', 'y']);
  });

  it('derives the payment status from stored totals', () => {
    expect(derivedPaymentStatus({ total: 100, refundedAmount: 0, current: 'paid' })).toBe('paid');
    expect(derivedPaymentStatus({ total: 100, refundedAmount: 40, current: 'paid' })).toBe('partially_refunded');
    expect(derivedPaymentStatus({ total: 100, refundedAmount: 100, current: 'partially_refunded' })).toBe('refunded');
  });
});
