import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const API_BASE_URL = 'http://localhost:3001';
const phoneNumberPattern = /^\+[1-9]\d{7,14}$/;
const otpPattern = /^\d{6}$/;
const amountPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

interface AuthResponse {
  token: string;
  tokenType: 'Bearer';
}

interface Loan {
  id: string;
  friendName: string;
  amount: string;
  dueDate: string;
  status: 'PENDING' | 'REPAID';
  createdAt: string;
  repaidAt: string | null;
}

interface LoanSummary {
  totalLent: string;
  totalRepaid: string;
  overdueAmount: string;
}

interface ApiResponse {
  error?: string;
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & ApiResponse;
  if (!response.ok) {
    throw new Error(body.error ?? 'The request failed. Please try again.');
  }
  return body;
}

function getFriendlyError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) {
    return 'Could not reach MiniLedger. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : fallback;
}

function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function App() {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [friendName, setFriendName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [formError, setFormError] = useState('');
  const [savingLoan, setSavingLoan] = useState(false);
  const [repayingLoanId, setRepayingLoanId] = useState<string | null>(null);

  async function requestOtp(): Promise<void> {
    const normalizedPhoneNumber = phoneNumber.trim();
    if (!phoneNumberPattern.test(normalizedPhoneNumber)) {
      setError('Enter a valid international phone number, including + and country code.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/otp/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: normalizedPhoneNumber }),
      });
      await readApiResponse<{ message: string }>(response);
      setPhoneNumber(normalizedPhoneNumber);
      setOtpRequested(true);
      setOtp('');
    } catch (requestError) {
      setError(getFriendlyError(requestError, 'Unable to request an OTP. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboard(authToken: string): Promise<void> {
    try {
      const headers = { Authorization: `Bearer ${authToken}` };
      const [loansResponse, summaryResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/loans`, { headers }),
        fetch(`${API_BASE_URL}/loans/summary`, { headers }),
      ]);
      const [loanData, summaryData] = await Promise.all([
        readApiResponse<Loan[]>(loansResponse),
        readApiResponse<LoanSummary>(summaryResponse),
      ]);
      setLoans(loanData);
      setSummary(summaryData);
      setDashboardError('');
    } catch (loadError) {
      setDashboardError(
        getFriendlyError(loadError, 'Could not load your loans. Please try again.'),
      );
    }
  }

  async function refreshDashboard(authToken: string): Promise<void> {
    setDashboardLoading(true);
    try {
      await loadDashboard(authToken);
    } finally {
      setDashboardLoading(false);
    }
  }

  async function verifyOtp(): Promise<void> {
    if (!otpPattern.test(otp)) {
      setError('Enter the six-digit OTP printed in the backend terminal.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, otp }),
      });
      const body = await readApiResponse<Partial<AuthResponse>>(response);
      if (typeof body.token !== 'string' || body.tokenType !== 'Bearer') {
        throw new Error('The server returned an unexpected authentication response.');
      }

      setDashboardLoading(true);
      setDashboardError('');
      try {
        await loadDashboard(body.token);
      } finally {
        setDashboardLoading(false);
      }
      setToken(body.token);
    } catch (verificationError) {
      setError(
        getFriendlyError(
          verificationError,
          'OTP verification failed. Request a new code and try again.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  async function createLoan(): Promise<void> {
    const normalizedFriendName = friendName.trim();
    const normalizedAmount = amount.trim();
    const normalizedDueDate = dueDate.trim();

    if (!normalizedFriendName || normalizedFriendName.length > 100) {
      setFormError('Enter a friend name between 1 and 100 characters.');
      return;
    }
    if (!amountPattern.test(normalizedAmount) || Number(normalizedAmount) <= 0) {
      setFormError('Enter a positive amount with up to two decimal places.');
      return;
    }
    if (!isValidDate(normalizedDueDate)) {
      setFormError('Enter a valid due date in YYYY-MM-DD format.');
      return;
    }
    if (!token) return;

    setSavingLoan(true);
    setFormError('');
    try {
      const response = await fetch(`${API_BASE_URL}/loans`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          friendName: normalizedFriendName,
          amount: normalizedAmount,
          dueDate: normalizedDueDate,
        }),
      });
      await readApiResponse<Loan>(response);
      setFriendName('');
      setAmount('');
      setDueDate('');
      await refreshDashboard(token);
    } catch (createError) {
      setFormError(getFriendlyError(createError, 'Could not save this loan. Please try again.'));
    } finally {
      setSavingLoan(false);
    }
  }

  async function repayLoan(loan: Loan): Promise<void> {
    if (!token || loan.status !== 'PENDING' || repayingLoanId) return;

    setRepayingLoanId(loan.id);
    setDashboardError('');
    try {
      const response = await fetch(`${API_BASE_URL}/loans/${loan.id}/repay`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      await readApiResponse<Loan>(response);
      await refreshDashboard(token);
    } catch (repayError) {
      setDashboardError(getFriendlyError(repayError, 'Could not mark this loan as repaid.'));
    } finally {
      setRepayingLoanId(null);
    }
  }

  function editPhoneNumber(): void {
    setOtpRequested(false);
    setOtp('');
    setError('');
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}>
          {token ? (
            <Dashboard
              amount={amount}
              dashboardError={dashboardError}
              dashboardLoading={dashboardLoading}
              dueDate={dueDate}
              error={formError}
              friendName={friendName}
              loadingLoanId={repayingLoanId}
              loans={loans}
              onAmountChange={setAmount}
              onCreateLoan={createLoan}
              onDueDateChange={setDueDate}
              onFriendNameChange={setFriendName}
              onRefresh={() => refreshDashboard(token)}
              onRepay={repayLoan}
              savingLoan={savingLoan}
              summary={summary}
            />
          ) : (
            <View style={styles.loginContainer}>
              <View style={styles.brandMark}>
                <Text style={styles.brandMarkText}>M</Text>
              </View>
              <Text style={styles.title}>MiniLedger</Text>
              <Text style={styles.subtitle}>
                {otpRequested
                  ? 'Enter your verification code to continue.'
                  : 'Keep track of the money you lend to friends.'}
              </Text>
              <View style={styles.card}>
                {!otpRequested ? (
                  <>
                    <Text style={styles.label}>Phone number</Text>
                    <TextInput
                      accessibilityLabel="Phone number"
                      autoComplete="tel"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!loading}
                      keyboardType="phone-pad"
                      onChangeText={setPhoneNumber}
                      placeholder="+14155552671"
                      placeholderTextColor="#89948f"
                      returnKeyType="done"
                      style={styles.input}
                      value={phoneNumber}
                    />
                    <Text style={styles.helperText}>Include + and your country code.</Text>
                    <ActionButton
                      disabled={loading}
                      label="Request OTP"
                      loading={loading}
                      onPress={requestOtp}
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.label}>Verification code</Text>
                    <Text style={styles.phoneHint}>Code sent to {phoneNumber}</Text>
                    <TextInput
                      accessibilityLabel="One-time password"
                      autoComplete="one-time-code"
                      editable={!loading}
                      keyboardType="number-pad"
                      maxLength={6}
                      onChangeText={value => setOtp(value.replace(/\D/g, ''))}
                      placeholder="000000"
                      placeholderTextColor="#89948f"
                      returnKeyType="done"
                      style={[styles.input, styles.otpInput]}
                      value={otp}
                    />
                    <Text style={styles.helperText}>
                      The code expires after five minutes. Find it in the backend terminal.
                    </Text>
                    <ActionButton
                      disabled={loading}
                      label="Verify OTP"
                      loading={loading}
                      onPress={verifyOtp}
                    />
                    <Pressable
                      accessibilityRole="button"
                      disabled={loading}
                      onPress={editPhoneNumber}
                      style={styles.textButton}>
                      <Text style={styles.textButtonLabel}>Use a different phone number</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={loading}
                      onPress={requestOtp}
                      style={styles.textButton}>
                      <Text style={styles.textButtonLabel}>Send a new code</Text>
                    </Pressable>
                  </>
                )}
                {error ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {error}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.footer}>Simple, clear lending between friends.</Text>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

interface DashboardProps {
  amount: string;
  dashboardError: string;
  dashboardLoading: boolean;
  dueDate: string;
  error: string;
  friendName: string;
  loadingLoanId: string | null;
  loans: Loan[];
  onAmountChange: (value: string) => void;
  onCreateLoan: () => Promise<void>;
  onDueDateChange: (value: string) => void;
  onFriendNameChange: (value: string) => void;
  onRefresh: () => Promise<void>;
  onRepay: (loan: Loan) => Promise<void>;
  savingLoan: boolean;
  summary: LoanSummary | null;
}

function Dashboard({
  amount,
  dashboardError,
  dashboardLoading,
  dueDate,
  error,
  friendName,
  loadingLoanId,
  loans,
  onAmountChange,
  onCreateLoan,
  onDueDateChange,
  onFriendNameChange,
  onRefresh,
  onRepay,
  savingLoan,
  summary,
}: DashboardProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.dashboardContent}
      keyboardShouldPersistTaps="handled">
      <View style={styles.dashboardHeader}>
        <View style={styles.headerBrand}>
          <View style={styles.smallBrandMark}>
            <Text style={styles.smallBrandMarkText}>M</Text>
          </View>
          <View>
            <Text style={styles.dashboardTitle}>MiniLedger</Text>
            <Text style={styles.dashboardSubtitle}>Your lending overview</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel="Refresh loans"
          accessibilityRole="button"
          onPress={onRefresh}
          style={styles.refreshButton}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.sectionTitle}>Summary</Text>
        {dashboardLoading && !summary ? (
          <ActivityIndicator color="#176b52" style={styles.summaryLoading} />
        ) : summary ? (
          <View style={styles.summaryGrid}>
            <SummaryValue label="Total lent" value={summary.totalLent} />
            <SummaryValue label="Repaid" value={summary.totalRepaid} />
            <SummaryValue
              highlight={summary.overdueAmount !== '0.00'}
              label="Overdue"
              value={summary.overdueAmount}
            />
          </View>
        ) : (
          <Text style={styles.mutedText}>Summary will appear when your loans load.</Text>
        )}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your loans</Text>
        <Text style={styles.loanCount}>{loans.length}</Text>
      </View>
      {dashboardError ? (
        <View style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.error}>
            {dashboardError}
          </Text>
          <Pressable accessibilityRole="button" onPress={onRefresh} style={styles.retryButton}>
            <Text style={styles.textButtonLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : dashboardLoading && loans.length === 0 ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color="#176b52" />
          <Text style={styles.mutedText}>Loading your loans…</Text>
        </View>
      ) : loans.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No loans yet</Text>
          <Text style={styles.mutedText}>Add a loan below to start your ledger.</Text>
        </View>
      ) : (
        loans.map(loan => (
          <LoanCard
            key={loan.id}
            loan={loan}
            loading={loadingLoanId === loan.id}
            onRepay={() => onRepay(loan)}
          />
        ))
      )}

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Add a loan</Text>
        <Text style={styles.label}>Friend’s name</Text>
        <TextInput
          accessibilityLabel="Friend's name"
          editable={!savingLoan}
          maxLength={100}
          onChangeText={onFriendNameChange}
          placeholder="e.g. Sam"
          placeholderTextColor="#89948f"
          style={styles.input}
          value={friendName}
        />
        <Text style={[styles.label, styles.spacedLabel]}>Amount</Text>
        <TextInput
          accessibilityLabel="Loan amount"
          editable={!savingLoan}
          keyboardType="decimal-pad"
          onChangeText={onAmountChange}
          placeholder="0.00"
          placeholderTextColor="#89948f"
          style={styles.input}
          value={amount}
        />
        <Text style={[styles.label, styles.spacedLabel]}>Due date</Text>
        <TextInput
          accessibilityLabel="Due date"
          editable={!savingLoan}
          onChangeText={onDueDateChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#89948f"
          style={styles.input}
          value={dueDate}
        />
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <ActionButton
          disabled={savingLoan}
          label="Save loan"
          loading={savingLoan}
          onPress={onCreateLoan}
        />
      </View>
      <Text style={styles.footer}>Simple, clear lending between friends.</Text>
    </ScrollView>
  );
}

function SummaryValue({
  highlight = false,
  label,
  value,
}: {
  highlight?: boolean;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.summaryValue}>
      <Text style={[styles.summaryAmount, highlight ? styles.overdueAmount : null]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function LoanCard({
  loan,
  loading,
  onRepay,
}: {
  loan: Loan;
  loading: boolean;
  onRepay: () => Promise<void>;
}) {
  const overdue = loan.status === 'PENDING' && loan.dueDate < getTodayUtc();

  return (
    <View style={[styles.loanCard, overdue ? styles.overdueCard : null]}>
      <View style={styles.loanCardHeader}>
        <Text style={styles.loanFriend}>{loan.friendName}</Text>
        <Text style={styles.loanAmount}>{loan.amount}</Text>
      </View>
      <View style={styles.loanMetaRow}>
        <Text style={styles.loanMeta}>Due {loan.dueDate}</Text>
        <Text
          style={[
            styles.statusBadge,
            overdue ? styles.overdueBadge : null,
            loan.status === 'REPAID' ? styles.repaidBadge : null,
          ]}>
          {overdue ? 'OVERDUE' : loan.status}
        </Text>
      </View>
      {loan.status === 'REPAID' && loan.repaidAt ? (
        <Text style={styles.repaidDate}>Repaid {loan.repaidAt.slice(0, 10)}</Text>
      ) : null}
      {loan.status === 'PENDING' ? (
        <Pressable
          accessibilityLabel={`Mark as repaid: ${loan.friendName}`}
          accessibilityRole="button"
          disabled={loading}
          onPress={onRepay}
          style={[styles.repayButton, loading ? styles.primaryButtonDisabled : null]}>
          {loading ? (
            <ActivityIndicator color="#176b52" />
          ) : (
            <Text style={styles.repayButtonText}>Mark as repaid</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

interface ActionButtonProps {
  disabled: boolean;
  label: string;
  loading: boolean;
  onPress: () => Promise<void>;
}

function ActionButton({ disabled, label, loading, onPress }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && !disabled ? styles.primaryButtonPressed : null,
        disabled ? styles.primaryButtonDisabled : null,
      ]}>
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text style={styles.primaryButtonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7f5',
  },
  keyboardView: {
    flex: 1,
  },
  loginContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  dashboardContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 36,
  },
  dashboardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerBrand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  smallBrandMark: {
    alignItems: 'center',
    backgroundColor: '#176b52',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  smallBrandMarkText: {
    color: '#ffffff',
    fontSize: 23,
    fontWeight: '700',
  },
  dashboardTitle: {
    color: '#18352b',
    fontSize: 22,
    fontWeight: '700',
  },
  dashboardSubtitle: {
    color: '#65746c',
    fontSize: 13,
    marginTop: 2,
  },
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  refreshButtonText: {
    color: '#176b52',
    fontSize: 14,
    fontWeight: '700',
  },
  brandMark: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#176b52',
    borderRadius: 18,
    height: 56,
    justifyContent: 'center',
    marginBottom: 18,
    width: 56,
  },
  brandMarkText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '700',
  },
  title: {
    color: '#18352b',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: '#65746c',
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 30,
    marginTop: 8,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#e5ebe7',
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    shadowColor: '#233d32',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 2,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    marginBottom: 12,
    marginTop: 24,
  },
  sectionTitle: {
    color: '#223a30',
    fontSize: 18,
    fontWeight: '700',
  },
  loanCount: {
    backgroundColor: '#e5f1eb',
    borderRadius: 20,
    color: '#176b52',
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5ebe7',
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    shadowColor: '#233d32',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  summaryValue: {
    flex: 1,
  },
  summaryAmount: {
    color: '#18352b',
    fontSize: 19,
    fontWeight: '700',
  },
  overdueAmount: {
    color: '#b3261e',
  },
  summaryLabel: {
    color: '#77847d',
    fontSize: 12,
    marginTop: 5,
  },
  summaryLoading: {
    marginVertical: 18,
  },
  loanCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5ebe7',
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    padding: 16,
  },
  overdueCard: {
    borderColor: '#e9aaa5',
    borderLeftWidth: 4,
  },
  loanCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  loanFriend: {
    color: '#18352b',
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    marginRight: 12,
  },
  loanAmount: {
    color: '#18352b',
    fontSize: 17,
    fontWeight: '700',
  },
  loanMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  loanMeta: {
    color: '#65746c',
    fontSize: 13,
  },
  statusBadge: {
    backgroundColor: '#fff3d6',
    borderRadius: 8,
    color: '#775500',
    fontSize: 10,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  overdueBadge: {
    backgroundColor: '#fde7e5',
    color: '#a22620',
  },
  repaidBadge: {
    backgroundColor: '#e5f1eb',
    color: '#176b52',
  },
  repaidDate: {
    color: '#77847d',
    fontSize: 12,
    marginTop: 10,
  },
  repayButton: {
    alignSelf: 'flex-start',
    marginTop: 12,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  repayButtonText: {
    color: '#176b52',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e5ebe7',
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 24,
  },
  emptyTitle: {
    color: '#18352b',
    fontSize: 16,
    fontWeight: '700',
  },
  mutedText: {
    color: '#77847d',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  formCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5ebe7',
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 24,
    padding: 18,
  },
  label: {
    color: '#223a30',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 9,
  },
  spacedLabel: {
    marginTop: 16,
  },
  phoneHint: {
    color: '#65746c',
    fontSize: 14,
    marginBottom: 14,
  },
  input: {
    backgroundColor: '#fbfcfb',
    borderColor: '#dbe4de',
    borderRadius: 12,
    borderWidth: 1,
    color: '#18352b',
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
  },
  otpInput: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: 8,
    textAlign: 'center',
  },
  helperText: {
    color: '#77847d',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 9,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#176b52',
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: 18,
    minHeight: 50,
  },
  primaryButtonPressed: {
    backgroundColor: '#105640',
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  textButton: {
    alignItems: 'center',
    paddingTop: 15,
  },
  textButtonLabel: {
    color: '#176b52',
    fontSize: 14,
    fontWeight: '600',
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingTop: 8,
  },
  errorCard: {
    backgroundColor: '#ffffff',
    borderColor: '#f1c5c2',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    padding: 14,
  },
  error: {
    color: '#b3261e',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  footer: {
    color: '#88958e',
    fontSize: 13,
    marginTop: 26,
    textAlign: 'center',
  },
});

export default App;
