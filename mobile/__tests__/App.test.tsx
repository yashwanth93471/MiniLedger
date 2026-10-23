import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { ReactNode } from 'react';
import App from '../App';

jest.mock('react-native-safe-area-context', () => {
  const ReactMock = require('react');
  return {
    SafeAreaProvider: ({ children }: { children: ReactNode }) =>
      ReactMock.createElement(ReactMock.Fragment, null, children),
    SafeAreaView: ({ children }: { children: ReactNode }) =>
      ReactMock.createElement('SafeAreaView', null, children),
  };
});

jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => {
  const ReactMock = require('react');
  return {
    __esModule: true,
    default: function TestPressable({ children, accessibilityLabel, disabled, onPress }: {
      children: ReactNode;
      accessibilityLabel?: string;
      disabled?: boolean;
      onPress?: () => void;
    }) {
      return ReactMock.createElement('View', {
        accessibilityLabel,
        disabled,
        onPress,
      }, children);
    },
  };
});

const phoneNumber = '+14155552671';
const token = 'test-jwt-token';
const originalFetch = globalThis.fetch;

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function response(body: unknown, status = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function findControl(root: ReactTestRenderer.ReactTestInstance, label: string) {
  return root.findAllByProps({ accessibilityLabel: label })[0];
}

async function login(root: ReactTestRenderer.ReactTestInstance) {
  await act(async () => {
    findControl(root, 'Phone number').props.onChangeText(phoneNumber);
  });
  await act(async () => {
    findControl(root, 'Request OTP').props.onPress();
  });
  await act(async () => {
    findControl(root, 'One-time password').props.onChangeText('123456');
  });
  await act(async () => {
    findControl(root, 'Verify OTP').props.onPress();
  });
}

beforeEach(() => {
  globalThis.fetch = jest.fn() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.clearAllMocks();
});

test('renders the login screen', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(findControl(renderer!.root, 'Phone number')).toBeTruthy();
  expect(findControl(renderer!.root, 'Request OTP')).toBeTruthy();
});

test("loads the authenticated user's loans and summary", async () => {
  const loans = [
    {
      id: 'loan-overdue',
      friendName: 'Jamie',
      amount: '20.50',
      dueDate: '2000-01-01',
      status: 'PENDING',
      createdAt: '2026-10-01T00:00:00.000Z',
      repaidAt: null,
    },
    {
      id: 'loan-repaid',
      friendName: 'Taylor',
      amount: '10.00',
      dueDate: '2026-10-01',
      status: 'REPAID',
      createdAt: '2026-10-02T00:00:00.000Z',
      repaidAt: '2026-10-03T00:00:00.000Z',
    },
  ];
  (globalThis.fetch as jest.Mock)
    .mockResolvedValueOnce(response({ message: 'OTP sent.' }))
    .mockResolvedValueOnce(response({ token, tokenType: 'Bearer' }))
    .mockResolvedValueOnce(response(loans))
    .mockResolvedValueOnce(response({ totalLent: '30.50', totalRepaid: '10.00', overdueAmount: '20.50' }));

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  await login(renderer!.root);

  expect(findControl(renderer!.root, 'Refresh loans')).toBeTruthy();
  expect(findControl(renderer!.root, 'Mark as repaid: Jamie')).toBeTruthy();
  expect(findControl(renderer!.root, 'Mark as repaid: Taylor')).toBeUndefined();
  expect((globalThis.fetch as jest.Mock).mock.calls[2][1].headers.Authorization).toBe(`Bearer ${token}`);
  expect((globalThis.fetch as jest.Mock).mock.calls[3][1].headers.Authorization).toBe(`Bearer ${token}`);
});

test('creates a loan with backend field names and refreshes dashboard data', async () => {
  const savedLoan = {
    id: 'created-loan',
    friendName: 'Sam',
    amount: '12.34',
    dueDate: '2026-12-31',
    status: 'PENDING',
    createdAt: '2026-10-22T00:00:00.000Z',
    repaidAt: null,
  };
  (globalThis.fetch as jest.Mock)
    .mockResolvedValueOnce(response({ message: 'OTP sent.' }))
    .mockResolvedValueOnce(response({ token, tokenType: 'Bearer' }))
    .mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response({ totalLent: '0.00', totalRepaid: '0.00', overdueAmount: '0.00' }))
    .mockResolvedValueOnce(response(savedLoan, 201))
    .mockResolvedValueOnce(response([savedLoan]))
    .mockResolvedValueOnce(response({ totalLent: '12.34', totalRepaid: '0.00', overdueAmount: '0.00' }));

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  await login(renderer!.root);

  await act(async () => {
    findControl(renderer!.root, "Friend's name").props.onChangeText(' Sam ');
    findControl(renderer!.root, 'Loan amount').props.onChangeText('12.34');
    findControl(renderer!.root, 'Due date').props.onChangeText('2026-12-31');
  });
  await act(async () => {
    findControl(renderer!.root, 'Save loan').props.onPress();
  });

  const calls = (globalThis.fetch as jest.Mock).mock.calls;
  expect(calls[4][0]).toBe('http://localhost:3001/loans');
  expect(JSON.parse(calls[4][1].body)).toEqual({
    friendName: 'Sam',
    amount: '12.34',
    dueDate: '2026-12-31',
  });
});

test('repays a pending loan and refreshes list and summary', async () => {
  const pendingLoan = {
    id: 'pending-loan',
    friendName: 'Jamie',
    amount: '5.00',
    dueDate: '2026-12-31',
    status: 'PENDING',
    createdAt: '2026-10-22T00:00:00.000Z',
    repaidAt: null,
  };
  const repaidLoan = { ...pendingLoan, status: 'REPAID', repaidAt: '2026-10-22T12:00:00.000Z' };
  (globalThis.fetch as jest.Mock)
    .mockResolvedValueOnce(response({ message: 'OTP sent.' }))
    .mockResolvedValueOnce(response({ token, tokenType: 'Bearer' }))
    .mockResolvedValueOnce(response([pendingLoan]))
    .mockResolvedValueOnce(response({ totalLent: '5.00', totalRepaid: '0.00', overdueAmount: '0.00' }))
    .mockResolvedValueOnce(response(repaidLoan))
    .mockResolvedValueOnce(response([repaidLoan]))
    .mockResolvedValueOnce(response({ totalLent: '5.00', totalRepaid: '5.00', overdueAmount: '0.00' }));

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  await login(renderer!.root);

  await act(async () => {
    findControl(renderer!.root, 'Mark as repaid: Jamie').props.onPress();
  });

  const calls = (globalThis.fetch as jest.Mock).mock.calls;
  expect(calls[4][0]).toBe('http://localhost:3001/loans/pending-loan/repay');
  expect(calls[4][1].method).toBe('PATCH');
  expect(calls[4][1].headers.Authorization).toBe(`Bearer ${token}`);
});
