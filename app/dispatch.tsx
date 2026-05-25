import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Platform, ActivityIndicator,
} from 'react-native';
import { ref, onValue, off, set, push, remove } from 'firebase/database';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { database, auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { fmtTime as tzFmtTime, COMPANY_TZ } from '@/lib/timezone';

const DISPATCHER_NAME = 'Dispatch Control';

interface OnlineDriver {
  vehicleId: string;
  driverId: string;
  status: string;
  zoneName?: string;
}

interface PendingBooking {
  id: string;
  PassengerName?: string;
  PassengerPhone?: string;
  PickAddress?: string;
  DropAddress?: string;
  VehicleType?: string;
  ScheduledFor?: string;
  Info?: string;
  CreatedBy?: string;
  CreatedByVehicle?: string;
  CreatedAt?: string;
  Status?: string;
}

interface Msg {
  id: string;
  body: string;
  from: 'driver' | 'dispatcher';
  senderName: string;
  ts: number;
}

function fmt(ts: number) {
  if (!ts) return '';
  return tzFmtTime(ts);
}

function fmtSchedule(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NZ', { timeZone: COMPANY_TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function DispatchTestPanel() {
  const { driver: authDriver } = useAuth();
  const companyId = authDriver?.companyId ?? '';

  const [authed,   setAuthed]   = useState(false);
  const [drivers,  setDrivers]  = useState<OnlineDriver[]>([]);
  const [bookings, setBookings] = useState<PendingBooking[]>([]);
  const [tab,      setTab]      = useState<'drivers' | 'unassigned'>('drivers');

  const [selected,  setSelected]  = useState<OnlineDriver | null>(null);
  const [selBook,   setSelBook]   = useState<PendingBooking | null>(null);

  const [messages,  setMessages]  = useState<Msg[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending,   setSending]   = useState(false);

  const [assignVehicle, setAssignVehicle] = useState('');
  const [assigning,     setAssigning]     = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setAuthed(true);
      else signInAnonymously(auth).catch(console.error);
    });
    return unsub;
  }, []);

  // Online drivers
  useEffect(() => {
    if (!authed || !companyId) return;
    const r = ref(database, `online/${companyId}`);
    onValue(r, (snap) => {
      const list: OnlineDriver[] = [];
      snap.forEach((child) => {
        const cur = child.val()?.current;
        if (!cur) return;
        list.push({
          vehicleId: cur.VehicleId ?? child.key ?? '',
          driverId:  String(cur.DriverId ?? ''),
          status:    cur.Status ?? 'Unknown',
          zoneName:  cur.ZoneName ?? '',
        });
      });
      setDrivers(list);
    });
    return () => off(r);
  }, [authed, companyId]);

  // Unassigned bookings from pendingjobs/{companyId}
  useEffect(() => {
    if (!authed || !companyId) return;
    const r = ref(database, `pendingjobs/${companyId}`);
    onValue(r, (snap) => {
      const list: PendingBooking[] = [];
      snap.forEach((child) => {
        const v = child.val();
        if (!v) return;
        list.push({ id: child.key ?? '', ...v });
      });
      // Sort newest first
      list.sort((a, b) => {
        const ta = a.CreatedAt ? new Date(a.CreatedAt).getTime() : 0;
        const tb = b.CreatedAt ? new Date(b.CreatedAt).getTime() : 0;
        return tb - ta;
      });
      setBookings(list);
    });
    return () => off(r);
  }, [authed, companyId]);

  // Messages for selected driver
  useEffect(() => {
    if (!selected || !authed) return;
    const chatRef = ref(database, `chat/${selected.vehicleId}`);

    const buildMsgs = (snap: any) => {
      const list: Msg[] = [];
      snap.forEach((child: any) => {
        const v = child.val();
        const body = v.Message ?? v.message ?? v.content ?? '';
        if (!body) return;
        const sid = String(v.SenderId ?? v.sender ?? 'dispatch').toLowerCase();
        const isDispatch = sid === 'dispatch' || sid === '0' || sid === '' || sid === 'dispatchcontrol';
        const ts = v.DateTime ? new Date(v.DateTime).getTime() : (v.timestamp ? new Date(v.timestamp).getTime() : 0);
        list.push({
          id:         child.key,
          body,
          from:       isDispatch ? 'dispatcher' : 'driver',
          senderName: v.SenderName ?? (isDispatch ? 'Dispatch' : `Driver ${selected.vehicleId}`),
          ts,
        });
      });
      list.sort((a, b) => a.ts - b.ts);
      setMessages(list);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 60);
    };

    onValue(chatRef, buildMsgs);
    return () => off(chatRef);
  }, [selected, authed]);

  const sendMsg = async () => {
    const body = inputText.trim();
    if (!body || !selected || sending) return;
    setSending(true);
    setInputText('');

    const now     = new Date();
    const dateStr = now.toISOString().slice(0, 16).replace('T', ' ');

    const notifPayload = {
      content:   body,
      bookingid: `safinahmohammed,${body},${dateStr},${companyId},Dispatcher`,
    };
    const chatPayload = {
      SenderId:   'dispatch',
      SenderName: DISPATCHER_NAME,
      Message:    body,
      DateTime:   now.toISOString(),
      CompanyId:  companyId,
    };

    try {
      const writes: Promise<any>[] = [
        push(ref(database, `chat/${selected.vehicleId}`), chatPayload) as unknown as Promise<any>,
      ];
      if (selected.driverId) {
        writes.push(set(ref(database, `notification/${selected.driverId}`), notifPayload));
      }
      await Promise.all(writes);
    } catch (e) {
      console.error('[Dispatch] send error:', e);
    } finally {
      setSending(false);
    }
  };

  const assignBooking = async () => {
    if (!selBook || !assignVehicle.trim()) return;
    setAssigning(true);
    try {
      const target = assignVehicle.trim().toUpperCase();
      // Write as a job notification to that vehicle
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 16).replace('T', ' ');
      const jobMsg = `BOOKING: ${selBook.PickAddress ?? ''}${selBook.DropAddress ? ' → ' + selBook.DropAddress : ''} | Pax: ${selBook.PassengerName ?? 'Unknown'} ${selBook.PassengerPhone ?? ''} | ${selBook.VehicleType ?? ''} | ${fmtSchedule(selBook.ScheduledFor)}`;

      await Promise.all([
        // Notify via chat
        push(ref(database, `chat/${target}`), {
          SenderId:   'dispatch',
          SenderName: DISPATCHER_NAME,
          Message:    jobMsg,
          DateTime:   now.toISOString(),
          CompanyId:  companyId,
        }),
        // Also send as notification popup
        set(ref(database, `notification/${target}`), {
          content:   jobMsg,
          bookingid: `safinahmohammed,${jobMsg},${dateStr},${companyId},${target}`,
        }),
        // Update the booking status
        set(ref(database, `pendingjobs/${companyId}/${selBook.id}/AssignedVehicle`), target),
        set(ref(database, `pendingjobs/${companyId}/${selBook.id}/Status`), 'Assigned'),
      ]);

      setAssignVehicle('');
      setSelBook(null);
    } catch (e) {
      console.error('[Dispatch] assign error:', e);
    } finally {
      setAssigning(false);
    }
  };

  const deleteBooking = async (id: string) => {
    try {
      await remove(ref(database, `pendingjobs/${companyId}/${id}`));
      if (selBook?.id === id) setSelBook(null);
    } catch (e) {
      console.error('[Dispatch] delete error:', e);
    }
  };

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.centred}>
        <Text style={{ color: '#fff' }}>This panel is web only.</Text>
      </View>
    );
  }

  const statusCol = (s: string) =>
    s === 'Available' ? '#22c55e' : s === 'Busy' ? '#f59e0b' : '#94a3b8';

  return (
    <View style={styles.root}>
      {/* ── Sidebar ───────────────────────────────────────────── */}
      <View style={styles.sidebar}>
        <Text style={styles.sidebarTitle}>Dispatch Panel</Text>
        <Text style={styles.sidebarSub}>Company {companyId}</Text>

        {/* Tab toggle */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'drivers' && styles.tabBtnActive]}
            onPress={() => { setTab('drivers'); setSelBook(null); }}
          >
            <Text style={[styles.tabBtnText, tab === 'drivers' && styles.tabBtnTextActive]}>
              Drivers {drivers.length > 0 ? `(${drivers.length})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'unassigned' && styles.tabBtnActive]}
            onPress={() => { setTab('unassigned'); setSelected(null); }}
          >
            <Text style={[styles.tabBtnText, tab === 'unassigned' && styles.tabBtnTextActive]}>
              U-A {bookings.length > 0 ? `(${bookings.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {!authed && (
          <View style={styles.centred}>
            <ActivityIndicator color="#facc15" />
            <Text style={{ color: '#94a3b8', marginTop: 8, fontSize: 13 }}>Connecting…</Text>
          </View>
        )}

        {/* Drivers list */}
        {tab === 'drivers' && authed && (
          <>
            {drivers.length === 0 && (
              <View style={styles.centred}>
                <Text style={{ color: '#94a3b8', fontSize: 13 }}>No drivers online</Text>
              </View>
            )}
            {drivers.map((d) => (
              <TouchableOpacity
                key={d.vehicleId}
                style={[
                  styles.driverRow,
                  selected?.vehicleId === d.vehicleId && styles.driverRowSelected,
                ]}
                onPress={() => { setSelected(d); setMessages([]); }}
                activeOpacity={0.7}
              >
                <View style={[styles.statusDot, { backgroundColor: statusCol(d.status) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.driverVehicle}>{d.vehicleId}</Text>
                  <Text style={styles.driverSub}>
                    ID {d.driverId || '?'}  ·  {d.status}
                    {d.zoneName ? `  ·  ${d.zoneName}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Unassigned bookings list */}
        {tab === 'unassigned' && authed && (
          <>
            {bookings.length === 0 && (
              <View style={styles.centred}>
                <Text style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', paddingHorizontal: 16 }}>
                  No unassigned bookings
                </Text>
              </View>
            )}
            <ScrollView>
              {bookings.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={[
                    styles.bookingRow,
                    selBook?.id === b.id && styles.bookingRowSelected,
                  ]}
                  onPress={() => setSelBook(b)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bookingPickup} numberOfLines={1}>
                      {b.PickAddress ?? '(no pickup)'}
                    </Text>
                    <Text style={styles.bookingSub} numberOfLines={1}>
                      {b.PassengerName || 'Unknown pax'}  ·  {b.VehicleType ?? 'Any'}
                    </Text>
                    <Text style={styles.bookingTime}>
                      {fmtSchedule(b.ScheduledFor)}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: b.Status === 'Assigned' ? '#22c55e22' : '#f59e0b22' }]}>
                    <Text style={[styles.statusBadgeText, { color: b.Status === 'Assigned' ? '#22c55e' : '#f59e0b' }]}>
                      {b.Status ?? 'Pending'}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}
      </View>

      {/* ── Main pane ─────────────────────────────────────────── */}
      <View style={styles.chatPane}>

        {/* DRIVERS TAB — chat pane */}
        {tab === 'drivers' && (
          !selected ? (
            <View style={styles.centred}>
              <Text style={{ color: '#94a3b8', fontSize: 15 }}>
                {drivers.length === 0
                  ? 'No drivers online yet — driver must Start Shift'
                  : 'Select a driver on the left'}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.chatHeader}>
                <View style={[styles.statusDot, { backgroundColor: statusCol(selected.status) }]} />
                <View>
                  <Text style={styles.chatHeaderTitle}>{selected.vehicleId}</Text>
                  <Text style={styles.chatHeaderSub}>Driver {selected.driverId}  ·  {selected.status}</Text>
                </View>
              </View>
              <ScrollView
                ref={scrollRef}
                style={styles.msgList}
                contentContainerStyle={{ padding: 16, gap: 10 }}
              >
                {messages.length === 0 && (
                  <Text style={{ color: '#64748b', textAlign: 'center', marginTop: 40, fontSize: 13 }}>
                    No messages yet.
                  </Text>
                )}
                {messages.map((m) => (
                  <View
                    key={m.id}
                    style={[
                      styles.bubble,
                      m.from === 'dispatcher' ? styles.myBubble : styles.theirBubble,
                    ]}
                  >
                    {m.from === 'driver' && (
                      <Text style={styles.bubbleName}>{m.senderName}</Text>
                    )}
                    <Text style={[
                      styles.bubbleText,
                      m.from === 'dispatcher' ? { color: '#0f172a' } : { color: '#f1f5f9' },
                    ]}>
                      {m.body}
                    </Text>
                    <Text style={[
                      styles.bubbleTime,
                      { color: m.from === 'dispatcher' ? '#0f172a88' : '#94a3b8' },
                    ]}>
                      {fmt(m.ts)}
                    </Text>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Type a message…"
                  placeholderTextColor="#64748b"
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={sendMsg}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  style={[styles.sendBtn, { opacity: (inputText.trim() && !sending) ? 1 : 0.4 }]}
                  onPress={sendMsg}
                  disabled={!inputText.trim() || sending}
                >
                  <Text style={styles.sendBtnText}>{sending ? '…' : 'Send'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )
        )}

        {/* UNASSIGNED TAB — booking detail */}
        {tab === 'unassigned' && (
          !selBook ? (
            <View style={styles.centred}>
              <Text style={{ color: '#94a3b8', fontSize: 15 }}>
                {bookings.length === 0 ? 'No unassigned bookings yet' : 'Select a booking on the left'}
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 28 }}>
              <Text style={styles.detailTitle}>Booking Detail</Text>

              <View style={styles.detailCard}>
                <DetailRow icon="📍" label="Pickup"   value={selBook.PickAddress ?? '—'} />
                <DetailRow icon="🏁" label="Drop-off" value={selBook.DropAddress ?? '(not specified)'} />
                <DetailRow icon="🕒" label="Scheduled" value={fmtSchedule(selBook.ScheduledFor)} />
                <DetailRow icon="🚗" label="Vehicle"  value={selBook.VehicleType ?? 'Any'} />
                <DetailRow icon="👤" label="Passenger" value={selBook.PassengerName ?? '—'} />
                <DetailRow icon="📞" label="Phone"    value={selBook.PassengerPhone ?? '—'} />
                {selBook.Info ? <DetailRow icon="📝" label="Notes" value={selBook.Info} /> : null}
                <DetailRow icon="🚕" label="Created by" value={`${selBook.CreatedByVehicle ?? ''} (Driver ${selBook.CreatedBy ?? ''})`} />
                <DetailRow icon="📋" label="Status" value={selBook.Status ?? 'Pending'} />
              </View>

              {/* Assign to vehicle */}
              <Text style={styles.assignLabel}>Assign to Vehicle</Text>
              <View style={styles.assignRow}>
                <TextInput
                  style={styles.assignInput}
                  placeholder="Vehicle ID (e.g. T003)"
                  placeholderTextColor="#64748b"
                  value={assignVehicle}
                  onChangeText={setAssignVehicle}
                  autoCapitalize="characters"
                />
                {drivers.map(d => (
                  <TouchableOpacity
                    key={d.vehicleId}
                    style={styles.driverChip}
                    onPress={() => setAssignVehicle(d.vehicleId)}
                  >
                    <View style={[styles.statusDot, { backgroundColor: statusCol(d.status) }]} />
                    <Text style={styles.driverChipText}>{d.vehicleId}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                <TouchableOpacity
                  style={[styles.assignBtn, { opacity: (assignVehicle.trim() && !assigning) ? 1 : 0.4 }]}
                  onPress={assignBooking}
                  disabled={!assignVehicle.trim() || assigning}
                >
                  <Text style={styles.assignBtnText}>{assigning ? 'Assigning…' : 'Assign & Notify Driver'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => deleteBooking(selBook.id)}
                >
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )
        )}
      </View>
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailIcon}>{icon}</Text>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, flexDirection: 'row',
    backgroundColor: '#0f172a',
    height: Platform.OS === 'web' ? ('100vh' as any) : '100%',
  },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  sidebar: {
    width: 240, backgroundColor: '#1e293b',
    borderRightWidth: 1, borderRightColor: '#334155',
    paddingTop: 24, flexDirection: 'column',
  },
  sidebarTitle: {
    color: '#facc15', fontSize: 16, fontWeight: '700',
    paddingHorizontal: 16, marginBottom: 2,
  },
  sidebarSub: {
    color: '#64748b', fontSize: 12,
    paddingHorizontal: 16, marginBottom: 12,
  },

  tabBar: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 12,
    backgroundColor: '#0f172a', borderRadius: 10, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#facc15' },
  tabBtnText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  tabBtnTextActive: { color: '#0f172a' },

  driverRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  driverRowSelected: { backgroundColor: '#facc1518', borderLeftColor: '#facc15' },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  driverVehicle: { color: '#f1f5f9', fontSize: 14, fontWeight: '700' },
  driverSub: { color: '#64748b', fontSize: 11, marginTop: 2 },

  bookingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderLeftWidth: 3, borderLeftColor: 'transparent',
    borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  bookingRowSelected: { backgroundColor: '#f59e0b18', borderLeftColor: '#f59e0b' },
  bookingPickup: { color: '#f1f5f9', fontSize: 13, fontWeight: '700' },
  bookingSub:    { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  bookingTime:   { color: '#64748b', fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },

  chatPane: { flex: 1, flexDirection: 'column' },
  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#334155',
    backgroundColor: '#1e293b',
  },
  chatHeaderTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  chatHeaderSub: { color: '#64748b', fontSize: 12, marginTop: 2 },

  msgList: { flex: 1 },
  bubble: {
    maxWidth: '70%', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 2,
  },
  myBubble: { alignSelf: 'flex-end', backgroundColor: '#facc15' },
  theirBubble: {
    alignSelf: 'flex-start', backgroundColor: '#1e293b',
    borderWidth: 1, borderColor: '#334155',
  },
  bubbleName: { color: '#94a3b8', fontSize: 11, marginBottom: 3 },
  bubbleText: { fontSize: 14 },
  bubbleTime: { fontSize: 11, marginTop: 4, textAlign: 'right' },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderTopWidth: 1, borderTopColor: '#334155',
    backgroundColor: '#1e293b',
  },
  textInput: {
    flex: 1, height: 44, backgroundColor: '#0f172a',
    borderRadius: 22, borderWidth: 1, borderColor: '#334155',
    color: '#f1f5f9', paddingHorizontal: 16, fontSize: 14,
    outlineStyle: 'none' as any,
  },
  sendBtn: {
    backgroundColor: '#facc15', borderRadius: 22,
    paddingHorizontal: 20, height: 44,
    justifyContent: 'center', alignItems: 'center',
  },
  sendBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 14 },

  // Detail pane
  detailTitle: {
    color: '#f1f5f9', fontSize: 22, fontWeight: '700', marginBottom: 20,
  },
  detailCard: {
    backgroundColor: '#1e293b', borderRadius: 16,
    borderWidth: 1, borderColor: '#334155',
    paddingVertical: 4, marginBottom: 24,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  detailIcon: { fontSize: 16, width: 24 },
  detailLabel: { color: '#64748b', fontSize: 13, width: 90 },
  detailValue: { color: '#f1f5f9', fontSize: 13, flex: 1 },

  assignLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '600', letterSpacing: 1.2, marginBottom: 10 },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  assignInput: {
    height: 44, backgroundColor: '#1e293b',
    borderRadius: 12, borderWidth: 1, borderColor: '#334155',
    color: '#f1f5f9', paddingHorizontal: 14, fontSize: 14,
    minWidth: 160, outlineStyle: 'none' as any,
  },
  driverChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1e293b', borderRadius: 20, borderWidth: 1, borderColor: '#334155',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  driverChipText: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  assignBtn: {
    backgroundColor: '#22c55e', borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  assignBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  deleteBtn: {
    backgroundColor: '#ef444422', borderRadius: 12, borderWidth: 1, borderColor: '#ef4444',
    paddingHorizontal: 16, paddingVertical: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  deleteBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },
});
