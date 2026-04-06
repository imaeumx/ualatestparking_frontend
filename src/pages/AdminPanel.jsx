import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { usePopup } from '../components/PopupContext';
import { decryptDES } from '../utils/desCrypto';

/**
 * AdminPanel Component
 *
 * High-level purpose:
 * - Central personnel dashboard for application review, reservation decisions,
 *   sticker verification, parking operations, and activity logs.
 *
 * Role model used in this file:
 * - root_admin: full access + can create personnel accounts
 * - admin: can manage applications/reservations/parking
 * - guard: focused parking operations + reservation no-show handling
 *
 * Design notes for study:
 * - Data is fetched from backend APIs and synchronized with localStorage for
 *   parking slots/logs/read-notification keys.
 * - Reservation state is reflected on parking slots via marker fields:
 *   `reservedFor` and `reservedStickerId`.
 * - Time-based behavior (overdue/escalation) uses `timeTick` interval refresh.
 */
export default function AdminPanel() {
    const navigate = useNavigate();
    const { showError, showInfo } = usePopup();
    const TOTAL_PARKING_SLOTS = 180;

    // Session user loaded from localStorage (set at login time).
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null') || {};

    // Normalize role text once to avoid repeated case-sensitive checks everywhere.
    const normalizedRole = (currentUser.role || '').toLowerCase();
    const isRootAdmin = normalizedRole === 'root_admin';
    const isAdmin = normalizedRole === 'admin' || isRootAdmin;
    const isGuard = normalizedRole === 'guard';

    // Application management state
    // records: all sticker applications visible to personnel.
    // search: plate-number text query used in applications table.
    const [records, setRecords] = useState([]);
    const [search, setSearch] = useState('');

    // Sticker verification state
    // verifyInput/activeVerify: lookup a specific sticker ID in applications list.
    // verifySecretKeyInput/hasValidVerifyKey: optional decrypt gate for verify view.
    const [verifyInput, setVerifyInput] = useState('');
    const [activeVerify, setActiveVerify] = useState('');
    const [verifySecretKeyInput, setVerifySecretKeyInput] = useState('');
    const [hasValidVerifyKey, setHasValidVerifyKey] = useState(false);

    // UI state
    // activeTab chooses which major section is rendered.
    const [activeTab, setActiveTab] = useState('applications');

    // Parking management state
    const [parkingSlots, setParkingSlots] = useState([]);
    const [parkStickerInput, setParkStickerInput] = useState('');
    const [parkGuestPlateInput, setParkGuestPlateInput] = useState('');
    const [selectedParkingAreaName, setSelectedParkingAreaName] = useState('Old Parking Space');
    const [selectedParkingSlotId, setSelectedParkingSlotId] = useState(null);
    const [parkingQuery, setParkingQuery] = useState('');
    const [parkingStatusFilter, setParkingStatusFilter] = useState('all');
    const [parkingListPage, setParkingListPage] = useState(1);
    const [applicationsPage, setApplicationsPage] = useState(1);
    const [reservationsPage, setReservationsPage] = useState(1);
    const [logsPage, setLogsPage] = useState(1);

    // Reservation management state
    // pendingReservations stores all fetched reservations; mini-tab filters list view.
    // editing* states control inline admin edits (status + notes + save spinner).
    const [pendingReservations, setPendingReservations] = useState([]);
    const [reservationMiniTab, setReservationMiniTab] = useState('pending');
    const [editingReservationId, setEditingReservationId] = useState(null);
    const [editReservationStatus, setEditReservationStatus] = useState('pending');
    const [editReservationNotes, setEditReservationNotes] = useState('');
    const [isSavingReservationEdit, setIsSavingReservationEdit] = useState(false);
    const [parkingLogs, setParkingLogs] = useState([]);
    const [timeTick, setTimeTick] = useState(Date.now());
    const [showPersonnelNotif, setShowPersonnelNotif] = useState(false);
    const [personnelNotifItems, setPersonnelNotifItems] = useState([]);
    const [readPersonnelNotifKeys, setReadPersonnelNotifKeys] = useState([]);

    // Root admin personnel creation form state.
    const [personnelFirstName, setPersonnelFirstName] = useState('');
    const [personnelLastName, setPersonnelLastName] = useState('');
    const [personnelEmail, setPersonnelEmail] = useState('');
    const [personnelUsername, setPersonnelUsername] = useState('');
    const [personnelPassword, setPersonnelPassword] = useState('');
    const [personnelRole, setPersonnelRole] = useState('admin');
    // Per-user localStorage key so each personnel account keeps independent read state.
    const personnelNotifReadStorageKey = `personnelNotifRead_${currentUser.username || 'personnel'}`;

    useEffect(() => {
        // Restore read-notification keys from localStorage on mount/user change.
        const savedReadKeys = JSON.parse(localStorage.getItem(personnelNotifReadStorageKey) || '[]');
        setReadPersonnelNotifKeys(Array.isArray(savedReadKeys) ? savedReadKeys : []);
    }, [personnelNotifReadStorageKey]);

    // Semester boundaries helper.
    // Returns inclusive start/end date range of current semester based on month.
    const getCurrentSemesterRange = (baseDate = new Date()) => {
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth() + 1;

        if (month >= 8 && month <= 12) {
            return { start: new Date(year, 7, 1), end: new Date(year, 11, 31) };
        }
        if (month >= 1 && month <= 5) {
            return { start: new Date(year, 0, 1), end: new Date(year, 4, 31) };
        }
        return { start: new Date(year, 5, 1), end: new Date(year, 6, 31) };
    };

    // A sticker is valid when approved and expiration date falls within current semester range.
    const isStickerValidForCurrentSemester = (record) => {
        if (!record || record.status !== 'Approved' || !record.expiration_date) {
            return false;
        }
        const expiration = new Date(`${record.expiration_date}T00:00:00`);
        if (Number.isNaN(expiration.getTime())) {
            return false;
        }
        const { start, end } = getCurrentSemesterRange(new Date());
        return expiration >= start && expiration <= end;
    };

    // Human-readable semester label for table badges/tooltips.
    const getSemesterLabelFromDate = (dateValue) => {
        const date = dateValue ? new Date(dateValue) : new Date();
        if (Number.isNaN(date.getTime())) return 'Unknown Semester';
        const month = date.getMonth() + 1;
        if (month >= 8 && month <= 12) return '1st Semester (Aug-Dec)';
        if (month >= 1 && month <= 5) return '2nd Semester (Jan-May)';
        return '3rd Semester (June-July)';
    };

    // Compact semester bucket key used for equality checks.
    const getSemesterBucket = (dateValue) => {
        const date = dateValue ? new Date(dateValue) : new Date();
        if (Number.isNaN(date.getTime())) return 'unknown';
        const month = date.getMonth() + 1;
        if (month >= 8 && month <= 12) return 'sem1';
        if (month >= 1 && month <= 5) return 'sem2';
        return 'sem3';
    };

    // Backward-compatible semester validity check used by older table logic.
    const isApprovedStickerValidThisSemester = (record) => {
        if (!record || record.status !== 'Approved' || !record.expiration_date) {
            return false;
        }
        const expiryDateTime = `${record.expiration_date}T00:00:00`;
        return isStickerValidForCurrentSemester(record) ||
            getSemesterBucket(expiryDateTime) === getSemesterBucket(new Date());
    };

    /**
     * Get valid (non-expired) sticker IDs from approved applications.
     * Used for parking validation and access control.
     */
    const getValidStickers = () => {
        if (!records || records.length === 0) return [];
        return [...new Set(records
            .filter(r => isStickerValidForCurrentSemester(r))
            .map(r => (r.sticker_id || '').trim().toUpperCase())
            .filter(id => id))]; // Remove null/empty and deduplicate
    };

    /**
     * Get plate number from sticker ID by looking up approved applications.
     */
    const getPlateFromSticker = (stickerId) => {
        if (!records || records.length === 0) return null;
        const normalizedStickerId = (stickerId || '').trim().toUpperCase();
        const application = records.find(r =>
            isStickerValidForCurrentSemester(r) &&
            (r.sticker_id || '').trim().toUpperCase() === normalizedStickerId
        );
        return application ? decryptData(application.plate_number) : null;
    };

    // Local alias used by existing table/render code.
    const decryptData = (ciphertext) => decryptDES(ciphertext);

    /**
     * Fetch all vehicle applications from the backend.
     * Updates local state and localStorage with valid stickers.
     */
    const fetchData = async () => {
        try {
            const res = await axios.get('http://127.0.0.1:8000/api/admin-records/', {
                params: {
                    requester_username: currentUser.username,
                    auth_token: currentUser.authToken || ''
                }
            });
            const freshRecords = res.data || [];
            setRecords(freshRecords);
            // Update valid stickers from fresh response to avoid stale state issues
            const validStickers = [...new Set(freshRecords
                .filter(r => isStickerValidForCurrentSemester(r))
                .map(r => (r.sticker_id || '').trim().toUpperCase())
                .filter(id => id))];
            localStorage.setItem('validParkingStickers', JSON.stringify(validStickers));
        } catch (err) {
            console.error("Admin fetch error:", err);
            setRecords([]); // Set empty array on error
        }
    };

    /**
     * Fetch pending parking spot reservations for admin approval.
     */
    const fetchPendingReservations = async () => {
        try {
            const res = await axios.get('http://127.0.0.1:8000/api/all-reservations/', {
                params: {
                    requester_username: currentUser.username,
                    auth_token: currentUser.authToken || ''
                }
            });
            setPendingReservations(res.data || []);
        } catch (err) {
            console.error("Pending reservations fetch error:", err);
            setPendingReservations([]);
        }
    };

    // Normalize reservation.reserved_spots to integer slot IDs array.
    // Supports backend sending either JSON array or JSON-stringified array.
    const parseReservationSpots = (reservation) => {
        if (!reservation) return [];
        const rawSpots = Array.isArray(reservation.reserved_spots)
            ? reservation.reserved_spots
            : (() => {
                try {
                    return JSON.parse(reservation.reserved_spots || '[]');
                } catch {
                    return [];
                }
            })();

        return rawSpots
            .map((spotId) => parseInt(spotId, 10))
            .filter((spotId) => !Number.isNaN(spotId));
    };

    // Reflect admin reservation decision onto parkingSlots markers.
    // approved => attach reservedFor/reservedStickerId marker to targeted slots
    // non-approved => clear reservation marker only if it belongs to same reservation
    const applyReservationToSlots = (reservation, nextStatus) => {
        if (!reservation) return;
        const normalizedSpots = parseReservationSpots(reservation);
        if (normalizedSpots.length === 0) return;

        const reservedSticker = (reservation.sticker_id || '').trim().toUpperCase();
        const reservedFor = reservation.reserved_for_datetime || null;
        const normalizedStatus = (nextStatus || '').toLowerCase();

        const updatedSlots = parkingSlots.map((slot) => {
            if (!normalizedSpots.includes(slot.id)) return slot;

            if (normalizedStatus === 'approved') {
                if (slot.status === 'occupied') return slot;
                return {
                    ...slot,
                    reservedFor,
                    reservedStickerId: reservedSticker
                };
            }

            const isSameReservationMarker =
                (slot.reservedFor || null) === reservedFor &&
                (slot.reservedStickerId || '').trim().toUpperCase() === reservedSticker;

            if (!isSameReservationMarker) return slot;
            return {
                ...slot,
                reservedFor: null,
                reservedStickerId: ''
            };
        });

        setParkingSlots(updatedSlots);
        localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));
    };

    // Start inline edit mode for one reservation row.
    const beginReservationEdit = (reservation) => {
        setEditingReservationId(reservation.id);
        setEditReservationStatus((reservation.status || 'pending').toLowerCase());
        setEditReservationNotes((reservation.admin_notes || '').trim());
    };

    // Cancel edit mode and reset temporary fields.
    const cancelReservationEdit = () => {
        setEditingReservationId(null);
        setEditReservationStatus('pending');
        setEditReservationNotes('');
    };

    // Persist admin reservation changes (status + notes) to backend.
    // On success, sync local slot markers and refresh reservation list.
    const saveReservationEdit = async (reservation) => {
        if (!reservation) return;

        try {
            setIsSavingReservationEdit(true);
            const payload = {
                reservation_id: reservation.id,
                status: (editReservationStatus || (reservation.status || 'pending')).toLowerCase(),
                admin_notes: (editReservationNotes || '').trim(),
                requester_username: currentUser.username,
                auth_token: currentUser.authToken || ''
            };

            const response = await axios.post('http://127.0.0.1:8000/api/update-reservation-admin/', payload);
            if (response.data.status === 'success') {
                applyReservationToSlots(reservation, payload.status);
                showInfo('Reservation updated successfully');
                cancelReservationEdit();
                fetchPendingReservations();
            } else {
                showError(response.data.message || 'Failed to update reservation');
            }
        } catch (err) {
            showError(err?.response?.data?.message || 'Failed to update reservation');
        } finally {
            setIsSavingReservationEdit(false);
        }
    };

    // Mount bootstrap:
    // 1) enforce personnel-only access
    // 2) enforce auth token presence
    // 3) fetch records/reservations + restore logs
    // 4) guards default to parking tab
    useEffect(() => {
        if (!isRootAdmin && !isAdmin && !isGuard) {
            navigate('/');
            return;
        }

        if (!currentUser.authToken) {
            showError('Session expired. Please login again.');
            navigate('/');
            return;
        }

        fetchData();
        if (isAdmin) {
            fetchPendingReservations();
        }

        const savedLogs = JSON.parse(localStorage.getItem('parkingLogs') || '[]');
        setParkingLogs(Array.isArray(savedLogs) ? savedLogs : []);

        if (isGuard) {
            setActiveTab('parking');
        }
    }, []);

    useEffect(() => {
        // Minute ticker used to recompute overdue/escalation time-based UI.
        const timer = setInterval(() => {
            setTimeTick(Date.now());
        }, 60 * 1000);
        return () => clearInterval(timer);
    }, []);

    // Initialize parking slots from localStorage or build clean defaults.
    // Also normalizes older slot objects that may miss reservation fields.
    useEffect(() => {
        const savedSlots = localStorage.getItem('parkingSlots');
        if (savedSlots) {
            const parsedSlots = JSON.parse(savedSlots);
            const normalizedSlots = Array.from({ length: TOTAL_PARKING_SLOTS }, (_, i) => {
                const existingSlot = parsedSlots.find(slot => slot.id === i + 1);
                if (existingSlot) {
                    return {
                        ...existingSlot,
                        reservedFor: existingSlot.reservedFor || null,
                        reservedStickerId: existingSlot.reservedStickerId || ''
                    };
                }
                return {
                    id: i + 1,
                    status: 'available',
                    plateNumber: '',
                    stickerId: '',
                    entryTime: null,
                    reservedFor: null,
                    reservedStickerId: ''
                };
            });
            setParkingSlots(normalizedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(normalizedSlots));
        } else {
            const initialSlots = Array.from({ length: TOTAL_PARKING_SLOTS }, (_, i) => ({
                id: i + 1,
                status: 'available',
                plateNumber: '',
                stickerId: '',
                entryTime: null,
                reservedFor: null,
                reservedStickerId: ''
            }));
            setParkingSlots(initialSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(initialSlots));
        }
    }, [TOTAL_PARKING_SLOTS]);

    /**
     * Update application status (Approve/Reject/Reset).
     * Triggers backend update and refreshes data.
     */
    const handleUpdateStatus = async (id, status) => {
        try {
            await axios.post('http://127.0.0.1:8000/api/update-status/', {
                id,
                status,
                requester_username: currentUser.username,
                auth_token: currentUser.authToken || ''
            });
            fetchData();
        } catch (err) { showError("Update failed"); }
    };

    // Sticker verification handlers
    const handleVerify = () => { setActiveVerify(verifyInput.trim().toUpperCase()); };
    const clearVerify = () => { setVerifyInput(''); setActiveVerify(''); };

    const handleVerifySecretKey = () => {
        // Manual key gate for non-admin users to reveal decrypted verify values.
        if ((verifySecretKeyInput || '').trim() === 'UA-SECRET-KEY') {
            setHasValidVerifyKey(true);
            showInfo('Valid secret key. Decrypted verify view enabled.');
        } else {
            setHasValidVerifyKey(false);
            showError('Invalid secret key.');
        }
    };

    // Enter key handler for sticker verify field.
    const handleVerifyKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleVerify();
        }
    };

    /**
     * Get application fee based on vehicle type.
     * 2-Wheels: ₱1,000, 4-Wheels: ₱2,000, Service: ₱3,000
     */
    const getFee = (type) => type?.includes("2") ? 1000 : (type?.includes("Service") ? 3000 : 2000);

    const handleSearchKeyPress = (e) => {
        if (e.key === 'Enter') {
            // Search is already handled by onChange, but Enter key provides immediate feedback
            setSearch(e.target.value.toLowerCase());
        }
    };

    // Append one parking event to local log history (keeps latest 300 entries).
    const addParkingLog = (eventType, slot, notes = '') => {
        const nextLog = {
            id: `${Date.now()}-${slot.id}`,
            timestamp: new Date().toISOString(),
            eventType,
            slotId: slot.id,
            plateNumber: slot.plateNumber || '',
            stickerId: slot.stickerId || slot.reservedStickerId || '',
            actor: currentUser.username || 'personnel',
            notes
        };

        const updatedLogs = [nextLog, ...parkingLogs].slice(0, 300);
        setParkingLogs(updatedLogs);
        localStorage.setItem('parkingLogs', JSON.stringify(updatedLogs));
    };

    // Build reservation timing state machine for one slot.
    // upcoming: before reserved time
    // active: reserved time to +30 minutes
    // overdue: beyond +30 minutes no-show window
    const getReservationInfo = (slot) => {
        if (!slot?.reservedFor || !slot?.reservedStickerId) return null;
        const reservedAt = new Date(slot.reservedFor);
        if (Number.isNaN(reservedAt.getTime())) return null;

        const graceEnd = new Date(reservedAt.getTime() + (30 * 60 * 1000));
        const now = new Date();

        return {
            reservedAt,
            graceEnd,
            isUpcoming: now < reservedAt,
            isActive: now >= reservedAt && now <= graceEnd,
            isOverdue: now > graceEnd
        };
    };

    // Human-readable status string shown in parking list/grid.
    const getParkingDisplayStatus = (slot) => {
        if (slot.status === 'occupied') return 'Occupied';
        const reservationInfo = getReservationInfo(slot);
        if (!reservationInfo) return 'Available';
        if (reservationInfo.isOverdue) return 'Reserved (Overdue)';
        if (reservationInfo.isActive) return 'Reserved (Now)';
        return 'Reserved';
    };

    const formatDateTime = (value) => {
        if (!value) return '---';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '---';
        return date.toLocaleString();
    };

    // Guest window means reservation is active/overdue and sticker marker is N/A.
    // In this flow, guard/admin can park using plate only (no sticker).
    const isGuestReservationWindow = (slot) => {
        if (!slot) return false;
        const reservationInfo = getReservationInfo(slot);
        const reservedSticker = (slot.reservedStickerId || '').trim().toUpperCase();
        return !!reservationInfo && (reservationInfo.isActive || reservationInfo.isOverdue) && reservedSticker === 'N/A';
    };

    // Guard/admin manual release for overdue reservations after verification of no-show.
    const releaseOverdueReservation = (slotId) => {
        const targetSlot = parkingSlots.find(slot => slot.id === slotId);
        if (!targetSlot) {
            showError('Slot not found.');
            return;
        }

        const reservationInfo = getReservationInfo(targetSlot);
        if (!reservationInfo || !reservationInfo.isOverdue) {
            showError('Only overdue reservations can be released.');
            return;
        }

        const updatedSlots = parkingSlots.map(slot =>
            slot.id === slotId
                ? { ...slot, reservedFor: null, reservedStickerId: '' }
                : slot
        );
        setParkingSlots(updatedSlots);
        localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));

        addParkingLog('reservation_release', targetSlot, 'Released after 30-minute no-show check.');
        showInfo(`Reservation released for slot ${slotId}.`);
    };

    /**
     * Park a vehicle in a specific slot.
     * Validates sticker ID and updates parking state.
     */
    const parkVehicle = (slotId, plateNumber, stickerId) => {
        const normalizedStickerId = (stickerId || '').trim().toUpperCase();
        const validStickers = getValidStickers();
        if (!validStickers.includes(normalizedStickerId)) {
            showError(`Invalid sticker ID. Valid approved stickers: ${validStickers.join(', ') || 'None available'}`);
            return false;
        }
        const updatedSlots = parkingSlots.map(slot =>
            slot.id === slotId
                ? {
                    ...slot,
                    status: 'occupied',
                    plateNumber,
                    stickerId: normalizedStickerId,
                    entryTime: new Date().toISOString(),
                    reservedFor: null,
                    reservedStickerId: ''
                }
                : slot
        );
        setParkingSlots(updatedSlots);
        localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));

        const occupiedSlot = updatedSlots.find(slot => slot.id === slotId);
        if (occupiedSlot) {
            addParkingLog('park', occupiedSlot, 'Parked by personnel panel action.');
        }
        return true;
    };

    // Guest/event parking flow for multi-spot reservations tagged as N/A sticker.
    const parkGuestVehicle = (slotId, plateNumber) => {
        const normalizedPlate = (plateNumber || '').trim().toUpperCase();
        if (!normalizedPlate) {
            showError('Please enter plate number for guest/event parking.');
            return false;
        }

        const updatedSlots = parkingSlots.map(slot =>
            slot.id === slotId
                ? {
                    ...slot,
                    status: 'occupied',
                    plateNumber: normalizedPlate,
                    stickerId: 'GUEST',
                    entryTime: new Date().toISOString(),
                    reservedFor: null,
                    reservedStickerId: ''
                }
                : slot
        );
        setParkingSlots(updatedSlots);
        localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));

        const occupiedSlot = updatedSlots.find(slot => slot.id === slotId);
        if (occupiedSlot) {
            addParkingLog('park', occupiedSlot, 'Parked under group/event reservation without sticker.');
        }
        return true;
    };

    /**
     * Remove vehicle from parking slot.
     */
    const leaveParking = (slotId) => {
        const slot = parkingSlots.find(s => s.id === slotId);
        if (slot && slot.status === 'occupied') {
            showInfo(`Vehicle ${slot.plateNumber} left parking successfully.`);
            const updatedSlots = parkingSlots.map(s =>
                s.id === slotId ? { ...s, status: 'available', plateNumber: '', stickerId: '', entryTime: null } : s
            );
            setParkingSlots(updatedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));
            addParkingLog('release', slot, 'Released by personnel due to vehicle checkout/update.');
        }
    };

    // Root-admin-only account creation endpoint for personnel onboarding.
    const handleCreatePersonnelAccount = async () => {
        if (!isRootAdmin) {
            showError('Only root admin can create personnel accounts.');
            return;
        }

        if (!personnelFirstName || !personnelLastName || !personnelEmail || !personnelUsername || !personnelPassword) {
            showError('Please complete all account fields.');
            return;
        }

        try {
            const response = await axios.post('http://127.0.0.1:8000/api/create-personnel-account/', {
                requester_username: currentUser.username,
                role: personnelRole,
                first_name: personnelFirstName.trim(),
                last_name: personnelLastName.trim(),
                email: personnelEmail.trim(),
                username: personnelUsername.trim(),
                password: personnelPassword.trim(),
                auth_token: currentUser.authToken || ''
            });

            if (response.data.status === 'success') {
                showInfo(response.data.message || 'Personnel account created.');
                setPersonnelFirstName('');
                setPersonnelLastName('');
                setPersonnelEmail('');
                setPersonnelUsername('');
                setPersonnelPassword('');
                setPersonnelRole('admin');
            } else {
                showError(response.data.message || 'Failed to create account.');
            }
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to create personnel account.');
        }
    };

    useEffect(() => {
        // Escalation notifier:
        // If reservation remains overdue for additional 5 minutes (35 total from start),
        // show guard/admin reminder and persist dedupe keys in localStorage.
        const now = Date.now();
        const escalationDelayMs = 5 * 60 * 1000;
        const escalatedSlots = parkingSlots.filter(slot => {
            const info = getReservationInfo(slot);
            if (!info || !info.isOverdue) return false;

            const overdueMs = now - info.graceEnd.getTime();
            return overdueMs >= escalationDelayMs;
        });

        if (escalatedSlots.length === 0) return;

        const personnelNotifRaw = JSON.parse(localStorage.getItem('personnelEscalationNotifs') || '[]');
        const personnelNotif = Array.isArray(personnelNotifRaw) ? personnelNotifRaw : [];

        let changed = false;
        escalatedSlots.forEach(slot => {
            const key = `${slot.id}-${slot.reservedFor || 'unknown'}-personnel-35m`;
            if (!personnelNotif.includes(key)) {
                personnelNotif.push(key);
                changed = true;
                showInfo(`Escalation alert: Slot ${slot.id} exceeded 35 minutes without Park update. Security guard should verify if no vehicle is present, then release the reservation.`, 2600);
            }
        });

        if (changed) {
            localStorage.setItem('personnelEscalationNotifs', JSON.stringify(personnelNotif.slice(-500)));
        }
    }, [parkingSlots, timeTick]);

    useEffect(() => {
        // Build notification dropdown items from active escalations and keep
        // read-key list trimmed to active keys so unread badge remains accurate.
        const now = Date.now();
        const escalationDelayMs = 5 * 60 * 1000;

        const items = parkingSlots
            .map((slot) => {
                const info = getReservationInfo(slot);
                if (!info || !info.isOverdue) return null;

                const overdueMs = now - info.graceEnd.getTime();
                if (overdueMs < escalationDelayMs) return null;

                const key = `${slot.id}-${slot.reservedFor || info.reservedAt.toISOString()}-personnel-35m`;
                const reservedForLabel = formatDateTime(slot.reservedFor || info.reservedAt.toISOString());
                return {
                    key,
                    slotId: slot.id,
                    reservedForLabel,
                    message: `Slot ${slot.id} exceeded 35 minutes without Park update. Security guard should verify and release if no vehicle is present.`
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.slotId - a.slotId);

        setPersonnelNotifItems(items);

        // Keep read keys clean so badge remains accurate for active alerts only.
        const activeKeys = new Set(items.map((item) => item.key));
        const cleanedReadKeys = readPersonnelNotifKeys.filter((key) => activeKeys.has(key));
        if (cleanedReadKeys.length !== readPersonnelNotifKeys.length) {
            setReadPersonnelNotifKeys(cleanedReadKeys);
            localStorage.setItem(personnelNotifReadStorageKey, JSON.stringify(cleanedReadKeys));
        }
    }, [parkingSlots, timeTick, readPersonnelNotifKeys, personnelNotifReadStorageKey]);

    const unreadPersonnelNotifCount = personnelNotifItems.filter(
        (item) => !readPersonnelNotifKeys.includes(item.key)
    ).length;

    // Mark current notification items as read for this personnel user.
    const markPersonnelNotifsAsRead = () => {
        const allKeys = personnelNotifItems.map((item) => item.key);
        setReadPersonnelNotifKeys(allKeys);
        localStorage.setItem(personnelNotifReadStorageKey, JSON.stringify(allKeys));
    };

    /**
     * Handle parking vehicle from table slot button.
     */
    const handleTableParkVehicle = (slotId) => {
        const targetSlot = parkingSlots.find((slot) => slot.id === slotId);
        if (isGuestReservationWindow(targetSlot)) {
            if (!parkGuestPlateInput.trim()) {
                showError('Enter plate number for guest/event parking.');
                return;
            }
            if (parkGuestVehicle(slotId, parkGuestPlateInput)) {
                setParkGuestPlateInput('');
            }
            return;
        }

        if (!parkStickerInput.trim()) {
            showError('Please enter a sticker ID first');
            return;
        }
        
        const sticker = parkStickerInput.trim().toUpperCase();
        const validStickers = getValidStickers();
        if (validStickers.includes(sticker)) {
            const plateNumber = getPlateFromSticker(sticker);
            if (plateNumber) {
                parkVehicle(slotId, plateNumber, sticker);
                setParkStickerInput('');
            } else {
                showError('Could not find plate number for this sticker ID');
            }
        } else {
            showError(`Invalid sticker ID. Valid approved stickers: ${validStickers.join(', ')}`);
        }
    };

    // Dashboard counters and derived table lists.
    const pendingCount = records.filter(r => r.status === 'Pending').length;
    const approvedCount = records.filter(r => r.status === 'Approved').length;
    const totalRevenue = records.filter(r => r.status === 'Approved')
                                .reduce((acc, curr) => acc + getFee(curr.vehicle_type), 0);
    const allReservationCount = pendingReservations.length;
    const pendingReservationRows = pendingReservations.filter(
        (reservation) => (reservation.status || '').toLowerCase() === 'pending'
    );
    const pendingReservationCount = pendingReservationRows.length;
    const displayedReservationRows = reservationMiniTab === 'pending' ? pendingReservationRows : pendingReservations;

    const APPLICATIONS_PAGE_SIZE = 20;
    const RESERVATIONS_PAGE_SIZE = 20;
    const LOGS_PAGE_SIZE = 20;

    const filteredApplicationRows = records
        .filter((record) => {
            if (activeVerify) return record.sticker_id === activeVerify;
            return decryptData(record.plate_number).toLowerCase().includes(search);
        })
        .slice()
        .reverse();
    const applicationsTotalPages = Math.max(1, Math.ceil(filteredApplicationRows.length / APPLICATIONS_PAGE_SIZE));
    const safeApplicationsPage = Math.min(applicationsPage, applicationsTotalPages);
    const paginatedApplicationRows = filteredApplicationRows.slice(
        (safeApplicationsPage - 1) * APPLICATIONS_PAGE_SIZE,
        (safeApplicationsPage - 1) * APPLICATIONS_PAGE_SIZE + APPLICATIONS_PAGE_SIZE
    );

    const reservationsTotalPages = Math.max(1, Math.ceil(displayedReservationRows.length / RESERVATIONS_PAGE_SIZE));
    const safeReservationsPage = Math.min(reservationsPage, reservationsTotalPages);
    const paginatedReservationRows = displayedReservationRows.slice(
        (safeReservationsPage - 1) * RESERVATIONS_PAGE_SIZE,
        (safeReservationsPage - 1) * RESERVATIONS_PAGE_SIZE + RESERVATIONS_PAGE_SIZE
    );

    const logsTotalPages = Math.max(1, Math.ceil(parkingLogs.length / LOGS_PAGE_SIZE));
    const safeLogsPage = Math.min(logsPage, logsTotalPages);
    const paginatedParkingLogs = parkingLogs.slice(
        (safeLogsPage - 1) * LOGS_PAGE_SIZE,
        (safeLogsPage - 1) * LOGS_PAGE_SIZE + LOGS_PAGE_SIZE
    );

    const parkingAreas = [
        { name: 'Old Parking Space', startId: 1, endId: 40, slotsPerRow: 10, totalRows: 4 },
        { name: 'Vertical Parking Space', startId: 41, endId: 90, slotsPerRow: 10, totalRows: 5 },
        { name: 'New Parking Space', startId: 91, endId: 180, slotsPerRow: 15, totalRows: 6 }
    ];

    const selectedParkingArea = parkingAreas.find(area => area.name === selectedParkingAreaName) || parkingAreas[0];
    const selectedAreaSlots = parkingSlots.filter(slot => (
        slot.id >= selectedParkingArea.startId && slot.id <= selectedParkingArea.endId
    ));

    const selectedAreaFilteredSlots = selectedAreaSlots.filter(slot => {
        const normalizedQuery = parkingQuery.trim().toLowerCase();
        const reservationInfo = getReservationInfo(slot);

        const statusMatch = (() => {
            if (parkingStatusFilter === 'all') return true;
            if (parkingStatusFilter === 'available') return slot.status === 'available' && !reservationInfo;
            if (parkingStatusFilter === 'occupied') return slot.status === 'occupied';
            if (parkingStatusFilter === 'reserved') return !!reservationInfo && !reservationInfo.isOverdue;
            if (parkingStatusFilter === 'overdue') return !!reservationInfo && reservationInfo.isOverdue;
            return true;
        })();

        const queryMatch = !normalizedQuery ||
            String(slot.id).includes(normalizedQuery) ||
            (slot.plateNumber || '').toLowerCase().includes(normalizedQuery) ||
            (slot.stickerId || '').toLowerCase().includes(normalizedQuery) ||
            (slot.reservedStickerId || '').toLowerCase().includes(normalizedQuery);

        return statusMatch && queryMatch;
    });

    const invalidSemesterStickerIds = [...new Set(
        records
            .filter(r => r.status === 'Approved' && !isApprovedStickerValidThisSemester(r))
            .map(r => (r.sticker_id || '').trim())
            .filter(Boolean)
    )];

    const canViewVerifyDecrypted = isAdmin || hasValidVerifyKey;

    const PARKING_LIST_PAGE_SIZE = 20;
    const parkingListTotalPages = Math.max(1, Math.ceil(selectedAreaFilteredSlots.length / PARKING_LIST_PAGE_SIZE));
    const safeParkingListPage = Math.min(parkingListPage, parkingListTotalPages);
    const parkingListStartIndex = (safeParkingListPage - 1) * PARKING_LIST_PAGE_SIZE;
    const paginatedAreaSlots = selectedAreaFilteredSlots.slice(parkingListStartIndex, parkingListStartIndex + PARKING_LIST_PAGE_SIZE);

    useEffect(() => {
        setParkingListPage(1);
    }, [selectedParkingAreaName, parkingQuery, parkingStatusFilter]);

    useEffect(() => {
        setApplicationsPage(1);
    }, [search, activeVerify]);

    useEffect(() => {
        setReservationsPage(1);
    }, [reservationMiniTab]);

    useEffect(() => {
        setLogsPage(1);
    }, [parkingLogs.length]);

    useEffect(() => {
        if (parkingListPage > parkingListTotalPages) {
            setParkingListPage(parkingListTotalPages);
        }
    }, [parkingListPage, parkingListTotalPages]);

    useEffect(() => {
        if (applicationsPage > applicationsTotalPages) {
            setApplicationsPage(applicationsTotalPages);
        }
    }, [applicationsPage, applicationsTotalPages]);

    useEffect(() => {
        if (reservationsPage > reservationsTotalPages) {
            setReservationsPage(reservationsTotalPages);
        }
    }, [reservationsPage, reservationsTotalPages]);

    useEffect(() => {
        if (logsPage > logsTotalPages) {
            setLogsPage(logsTotalPages);
        }
    }, [logsPage, logsTotalPages]);

    return (
        <div className="center">
            <div className="card admin-large-card">
                
                {/* TOPBAR */}
                <div className="topbar" style={{ marginBottom: '20px' }}>
                    <div>
                        <h2>UA Personnel Management</h2>
                        <p className="subtitle">Role: {isRootAdmin ? 'ROOT ADMIN' : isAdmin ? 'ADMIN' : 'SECURITY GUARD'}</p>
                    </div>
                    <div className="topbar-actions" style={{ gap: '10px', position: 'relative' }}>
                        <button className="btn-gray slim bell-btn" onClick={() => setShowPersonnelNotif(!showPersonnelNotif)}>
                            🔔
                            {unreadPersonnelNotifCount > 0 && <span className="notif-count">{unreadPersonnelNotifCount}</span>}
                        </button>

                        {showPersonnelNotif && (
                            <div className="notif-dropdown" style={{ minWidth: '360px' }}>
                                <h4>Notifications</h4>
                                {personnelNotifItems.length === 0 ? (
                                    <p className="empty-notif">No new notifications.</p>
                                ) : (
                                    personnelNotifItems.map((notif) => (
                                        <div key={notif.key} className="notif-item">
                                            <strong>Reserved For:</strong> {notif.reservedForLabel}<br />
                                            {notif.message}
                                        </div>
                                    ))
                                )}
                                {personnelNotifItems.length > 0 && unreadPersonnelNotifCount > 0 && (
                                    <button className="link-btn mark-read" onClick={markPersonnelNotifsAsRead}>Mark as Read</button>
                                )}
                            </div>
                        )}

                        <button className="btn-blue slim" onClick={() => navigate('/')}>Logout</button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: '0 0 260px', width: '260px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <aside style={{
                            border: '1px solid #dbe3ee',
                            borderRadius: '12px',
                            background: '#f8fafc',
                            padding: '12px'
                        }}>
                            <div style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.7px', color: '#64748b', textTransform: 'uppercase', marginBottom: '10px' }}>
                                Navigation
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {isAdmin && (
                                    <button
                                        type="button"
                                        className={`tab-button ${activeTab === 'applications' ? 'active' : ''}`}
                                        onClick={() => setActiveTab('applications')}
                                    >
                                        Applications
                                    </button>
                                )}
                                {isAdmin && (
                                    <button
                                        type="button"
                                        className={`tab-button ${activeTab === 'reservations' ? 'active' : ''}`}
                                        onClick={() => {
                                            setActiveTab('reservations');
                                            fetchPendingReservations();
                                        }}
                                    >
                                        Reservations ({pendingReservationCount})
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className={`tab-button ${activeTab === 'parking' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('parking')}
                                >
                                    Parking Management
                                </button>
                                {isAdmin && (
                                    <button
                                        type="button"
                                        className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`}
                                        onClick={() => setActiveTab('logs')}
                                    >
                                        Parking Logs
                                    </button>
                                )}
                                {isRootAdmin && (
                                    <button
                                        type="button"
                                        className={`tab-button ${activeTab === 'accounts' ? 'active' : ''}`}
                                        onClick={() => setActiveTab('accounts')}
                                    >
                                        Personnel Accounts
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className={`tab-button ${activeTab === 'verify' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('verify')}
                                >
                                    Verify Sticker
                                </button>
                            </div>
                        </aside>

                        {activeTab === 'parking' && (
                            <div style={{ border: '1px solid #cbd5e1', borderRadius: '12px', padding: '10px', background: '#f8fafc' }}>
                                <h4 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: '0.9rem' }}>Parking Map</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {parkingAreas.map((area) => {
                                        const isActive = selectedParkingAreaName === area.name;
                                        return (
                                            <button
                                                key={`sidebar-area-${area.name}`}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedParkingAreaName(area.name);
                                                    setSelectedParkingSlotId(null);
                                                }}
                                                style={{
                                                    padding: '8px 10px',
                                                    borderRadius: '8px',
                                                    fontSize: '0.85rem',
                                                    fontWeight: 700,
                                                    textAlign: 'left',
                                                    cursor: 'pointer',
                                                    border: isActive ? '1px solid #bfdbfe' : '1px solid #d1d5db',
                                                    background: isActive ? '#dbeafe' : '#f8fafc',
                                                    color: isActive ? '#1d4ed8' : '#334155'
                                                }}
                                            >
                                                {area.name}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ flex: '1 1 780px', minWidth: 0 }}>

                {activeTab === 'applications' && isAdmin && (
                <>

                {/* STATS ROW */}
                <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px', marginBottom: '20px' }}>
                    <div className="stat-card"><h3>TOTAL APPS</h3><p>{records.length}</p></div>
                    <div className="stat-card" style={{ borderTop: '4px solid #ea580c' }}><h3 style={{color:'#ea580c'}}>PENDING</h3><p style={{color:'#ea580c'}}>{pendingCount}</p></div>
                    <div className="stat-card" style={{ borderTop: '4px solid #16a34a' }}><h3 style={{color:'#16a34a'}}>APPROVED</h3><p style={{color:'#16a34a'}}>{approvedCount}</p></div>
                    <div className="stat-card" style={{ borderTop: '4px solid #2563eb' }}><h3>REVENUE</h3><p>₱{totalRevenue.toLocaleString()}</p></div>
                </div>

                {/* TABLE PANEL */}
                <div className="panel">
                    <div className="panel-header-with-filter">
                        <h3 style={{ margin: 0 }}>Application Records</h3>
                        <div className="filter-controls">
                            <span className="status-badge approved">Decrypted View</span>
                            <input type="text" className="table-filter" placeholder="Search Plate..." onChange={(e) => setSearch(e.target.value.toLowerCase())} onKeyDown={handleSearchKeyPress} />
                        </div>
                    </div>

                    <div className="table-wrap">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Owner Name</th>
                                    <th>Role & Details</th>
                                    <th>Plate Number</th>
                                    <th>Sticker ID</th>
                                    <th>Type</th>
                                    <th>Fee</th>
                                    <th>Payment Method</th>
                                    <th>Reference No.</th>
                                    <th>Expires</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedApplicationRows.map((v) => (
                                    <tr key={v.id}>
                                        <td style={{ fontWeight: 600 }}>{decryptData(v.owner_name)}</td>
                                        
                                        {/* ROLE INFO COLUMN */}
                                        <td>
                                            <div style={{ lineHeight: '1.2' }}>
                                                {(() => {
                                                    const normalizedRole = (v.role || '').toLowerCase();
                                                    const isNonStudent = normalizedRole === 'guest' || normalizedRole === 'non-student';
                                                    const roleText = isNonStudent ? 'NON-STUDENT' : (v.role || 'USER');
                                                    return (
                                                <strong style={{ 
                                                    display: 'block', 
                                                    fontSize: '0.75rem', 
                                                    color: isNonStudent ? '#2563eb' : '#ea580c',
                                                    textTransform: 'uppercase' 
                                                }}>
                                                    {roleText}
                                                </strong>
                                                    );
                                                })()}
                                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                    {v.identifier || 'N/A'}
                                                </span>
                                            </div>
                                        </td>

                                        <td className="bold-plate">{decryptData(v.plate_number)}</td>
                                        <td className="sticker-id-text">{v.sticker_id || '---'}</td>
                                        <td>{v.vehicle_type}</td>
                                        <td>₱{getFee(v.vehicle_type).toLocaleString()}</td>
                                        <td>{v.payment_method || '---'}</td>
                                        <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{v.payment_reference || '---'}</td>
                                        <td>
                                            {v.expiration_date ? (
                                                <span style={{ 
                                                    color: new Date(v.expiration_date) < new Date() ? '#dc2626' : '#16a34a',
                                                    fontWeight: 'bold'
                                                }}>
                                                    {new Date(v.expiration_date).toLocaleDateString()}
                                                </span>
                                            ) : '---'}
                                        </td>
                                        <td>
                                            <span className={`status-badge ${v.status.toLowerCase()}`}>
                                                {v.status}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            {v.status === 'Pending' ? (
                                                <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end' }}>
                                                    <button className="btn-green slim" onClick={() => handleUpdateStatus(v.id, 'Approved')}>✔</button>
                                                    <button className="btn-red slim" onClick={() => handleUpdateStatus(v.id, 'Rejected')}>✖</button>
                                                </div>
                                            ) : <button className="btn-gray slim" onClick={() => handleUpdateStatus(v.id, 'Pending')}>Reset</button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                        <button
                            className="btn-gray slim"
                            onClick={() => setApplicationsPage((prev) => Math.max(1, prev - 1))}
                            disabled={safeApplicationsPage === 1}
                            style={{ marginTop: 0, opacity: safeApplicationsPage === 1 ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                        >
                            Prev
                        </button>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', minWidth: '82px', textAlign: 'center' }}>
                            Page {safeApplicationsPage} of {applicationsTotalPages}
                        </span>
                        <button
                            className="btn-gray slim"
                            onClick={() => setApplicationsPage((prev) => Math.min(applicationsTotalPages, prev + 1))}
                            disabled={safeApplicationsPage === applicationsTotalPages}
                            style={{ marginTop: 0, opacity: safeApplicationsPage === applicationsTotalPages ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                        >
                            Next
                        </button>
                    </div>
                </div>

                </>)}

                {activeTab === 'verify' && (
                <>

                <div className="panel" style={{ textAlign: 'center', padding: '20px' }}>
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '15px' }}>Quick Verify Sticker</h3>
                    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                                type="text"
                                placeholder="Enter Sticker ID (e.g. UA-001)"
                                value={verifyInput}
                                style={{ textAlign: 'center', fontSize: '1rem', padding: '10px', maxWidth: '360px', height: '36px' }}
                                onChange={(e) => setVerifyInput(e.target.value)}
                                onKeyDown={handleVerifyKeyPress}
                            />
                            <button
                                className="btn-blue slim"
                                onClick={handleVerify}
                                style={{ marginTop: 0, height: '36px', minWidth: '110px', fontSize: '12px', padding: '4px 10px' }}
                            >
                                Verify
                            </button>
                            {activeVerify && (
                                <button
                                    className="btn-gray slim"
                                    onClick={clearVerify}
                                    style={{ marginTop: 0, height: '36px', minWidth: '90px', fontSize: '12px', padding: '4px 10px' }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        {!isAdmin && (
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                                <input
                                    type="password"
                                    placeholder="Enter Secret Key"
                                    value={verifySecretKeyInput}
                                    onChange={(e) => setVerifySecretKeyInput(e.target.value)}
                                    style={{ textAlign: 'left', fontSize: '14px', padding: '10px 12px', width: '360px', maxWidth: '360px', height: '36px' }}
                                />
                                <button className="btn-gray slim" onClick={handleVerifySecretKey} style={{ marginTop: 0, height: '36px', minWidth: '110px', fontSize: '12px', padding: '4px 10px' }}>
                                    Unlock
                                </button>
                            </div>
                        )}
                    </div>

                    <div style={{ marginTop: '16px', textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#f8fafc' }}>
                        <div><strong>Valid Stickers from Approved Applications:</strong> {getValidStickers().join(', ') || 'None'}</div>
                        <p style={{ fontSize: '0.9em', color: '#334155', marginTop: '8px', marginBottom: '0' }}>
                            Parking access is automatically granted to approved sticker IDs valid for the current semester.
                            Semester windows: Jan-May, Jun-Jul, Aug-Dec.
                        </p>
                        {invalidSemesterStickerIds.length > 0 && (
                            <p style={{ fontSize: '0.9em', color: '#dc2626', marginTop: '8px', marginBottom: '0' }}>
                                ⚠️ Invalid this semester: {invalidSemesterStickerIds.join(', ')}
                            </p>
                        )}
                    </div>

                    {activeVerify && (
                        <div style={{ marginTop: '18px', textAlign: 'left' }}>
                            {(() => {
                                const record = records.find(r => (r.sticker_id || '').toUpperCase() === activeVerify);
                                if (!record) {
                                    return <p style={{ color: '#b91c1c', fontWeight: 700 }}>No record found for {activeVerify}.</p>;
                                }
                                const validSemester = isStickerValidForCurrentSemester(record);
                                const validityPeriodLabel = getSemesterLabelFromDate(record.expiration_date ? `${record.expiration_date}T00:00:00` : null);
                                const isCurrentSemesterBucketMatch = getSemesterBucket(record.expiration_date ? `${record.expiration_date}T00:00:00` : null) === getSemesterBucket(new Date());
                                const verificationStatusLabel = record.status === 'Pending'
                                    ? 'Pending ⏳'
                                    : (record.status === 'Approved' && (validSemester || isCurrentSemesterBucketMatch) ? 'Active ✅' : 'Expired ❌');
                                return (
                                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#f8fafc' }}>
                                        <div><strong>Sticker:</strong> {record.sticker_id}</div>
                                        <div><strong>Status:</strong> {verificationStatusLabel}</div>
                                        <div><strong>Validity Period:</strong> {validityPeriodLabel}</div>
                                        <div><strong>Plate:</strong> {canViewVerifyDecrypted ? decryptData(record.plate_number) : (record.plate_number || '---')}</div>
                                        <div><strong>Owner:</strong> {canViewVerifyDecrypted ? decryptData(record.owner_name) : (record.owner_name || '---')}</div>
                                        {!canViewVerifyDecrypted && (
                                            <div style={{ marginTop: '8px', color: '#b45309', fontSize: '12px', fontWeight: 700 }}>
                                                Data is DES encrypted. Enter a valid secret key to decrypt.
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    )}
                </div>

                </>)}

                {activeTab === 'reservations' && isAdmin && (
                <>

                {/* ALL RESERVATIONS */}
                <div className="panel" style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', marginBottom: '10px' }}>
                        <h3 style={{ margin: 0 }}>📋 Reservations</h3>
                        <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: '2px' }}>
                            <button
                                type="button"
                                className={`tab-button ${reservationMiniTab === 'pending' ? 'active' : ''}`}
                                onClick={() => setReservationMiniTab('pending')}
                                style={{ marginTop: 0, padding: '6px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                            >
                                Pending Reservations ({pendingReservationCount})
                            </button>
                            <button
                                type="button"
                                className={`tab-button ${reservationMiniTab === 'all' ? 'active' : ''}`}
                                onClick={() => setReservationMiniTab('all')}
                                style={{ marginTop: 0, padding: '6px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                            >
                                All Parking Reservations ({allReservationCount})
                            </button>
                        </div>
                    </div>

                    {displayedReservationRows.length === 0 ? (
                        <p style={{ color: '#64748b' }}>
                            {reservationMiniTab === 'pending' ? 'No pending reservations found' : 'No reservations found'}
                        </p>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>User</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Sticker ID</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Spots</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Reason</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Reserved For</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Requested</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0', minWidth: '220px' }}>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedReservationRows.map((res) => {
                                        const isEditing = editingReservationId === res.id;
                                        return (
                                        <tr key={res.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                            <td style={{ padding: '10px' }}>{res.applicant_username}</td>
                                            <td style={{ padding: '10px', fontWeight: 600 }}>{res.sticker_id || 'N/A'}</td>
                                            <td style={{ padding: '10px' }}>
                                                {Array.isArray(res.reserved_spots) 
                                                    ? res.reserved_spots.join(', ')
                                                    : JSON.parse(res.reserved_spots || '[]').join(', ')}
                                            </td>
                                            <td style={{ padding: '10px', fontSize: '12px' }}>{res.reservation_reason}</td>
                                            <td style={{ padding: '10px', fontSize: '12px' }}>
                                                {new Date(res.reserved_for_datetime).toLocaleString()}
                                            </td>
                                            <td style={{ padding: '10px' }}>
                                                {isEditing ? (
                                                    <select
                                                        value={editReservationStatus}
                                                        onChange={(e) => setEditReservationStatus((e.target.value || '').toLowerCase())}
                                                        style={{ padding: '4px 6px', fontSize: '11px', minWidth: '120px' }}
                                                    >
                                                        <option value="pending">pending</option>
                                                        <option value="approved">approved</option>
                                                        <option value="denied">denied</option>
                                                        <option value="cancelled">cancelled</option>
                                                    </select>
                                                ) : (
                                                    <span style={{
                                                        display: 'inline-block',
                                                        padding: '4px 8px',
                                                        borderRadius: '999px',
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        background: (res.status || '').toLowerCase() === 'approved' ? '#dcfce7' : (res.status || '').toLowerCase() === 'denied' ? '#fee2e2' : '#fef3c7',
                                                        color: (res.status || '').toLowerCase() === 'approved' ? '#166534' : (res.status || '').toLowerCase() === 'denied' ? '#b91c1c' : '#92400e',
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        {res.status || 'pending'}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '10px', fontSize: '12px' }}>
                                                {new Date(res.created_at).toLocaleString()}
                                            </td>
                                            <td style={{ padding: '10px', fontSize: '12px', minWidth: '220px' }}>
                                                {isEditing ? (
                                                    <>
                                                        <input
                                                            type="text"
                                                            placeholder="Admin notes..."
                                                            value={editReservationNotes}
                                                            onChange={(e) => setEditReservationNotes(e.target.value)}
                                                            style={{ width: '100%', padding: '4px', fontSize: '11px', marginBottom: '6px' }}
                                                        />
                                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                                                            <button
                                                                type="button"
                                                                className="btn-green slim"
                                                                onClick={() => saveReservationEdit(res)}
                                                                disabled={isSavingReservationEdit}
                                                                style={{ marginTop: 0, padding: '4px 8px', fontSize: '11px', opacity: isSavingReservationEdit ? 0.7 : 1 }}
                                                            >
                                                                Save
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="btn-gray slim"
                                                                onClick={cancelReservationEdit}
                                                                disabled={isSavingReservationEdit}
                                                                style={{ marginTop: 0, padding: '4px 8px', fontSize: '11px' }}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                                        <span style={{ color: '#475569' }}>{(res.admin_notes || '').trim() || 'No notes added'}</span>
                                                        <button
                                                            type="button"
                                                            className="btn-gray slim"
                                                            onClick={() => beginReservationEdit(res)}
                                                            title="Edit status and notes"
                                                            style={{ marginTop: 0, padding: '2px 7px', fontSize: '12px', lineHeight: 1 }}
                                                        >
                                                            ✏
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {displayedReservationRows.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <button
                                className="btn-gray slim"
                                onClick={() => setReservationsPage((prev) => Math.max(1, prev - 1))}
                                disabled={safeReservationsPage === 1}
                                style={{ marginTop: 0, opacity: safeReservationsPage === 1 ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                            >
                                Prev
                            </button>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', minWidth: '82px', textAlign: 'center' }}>
                                Page {safeReservationsPage} of {reservationsTotalPages}
                            </span>
                            <button
                                className="btn-gray slim"
                                onClick={() => setReservationsPage((prev) => Math.min(reservationsTotalPages, prev + 1))}
                                disabled={safeReservationsPage === reservationsTotalPages}
                                style={{ marginTop: 0, opacity: safeReservationsPage === reservationsTotalPages ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>

                </>)}

                {activeTab === 'parking' && (isRootAdmin || isAdmin || isGuard) && (
                <>

                <div className="panel">
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 780px', minWidth: '780px' }}>
                            <h3>{selectedParkingArea.name} List</h3>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                                <input
                                    type="text"
                                    placeholder="Search slot, plate, or sticker"
                                    value={parkingQuery}
                                    onChange={(e) => setParkingQuery(e.target.value)}
                                    style={{ maxWidth: '230px', height: '36px', fontSize: '12px', padding: '8px 10px' }}
                                />
                                <select
                                    value={parkingStatusFilter}
                                    onChange={(e) => setParkingStatusFilter(e.target.value)}
                                    style={{ maxWidth: '170px', height: '36px', fontSize: '12px', padding: '6px 10px' }}
                                >
                                    <option value="all">All Status</option>
                                    <option value="available">Available</option>
                                    <option value="occupied">Occupied</option>
                                    <option value="reserved">Reserved</option>
                                    <option value="overdue">Reserved (Overdue)</option>
                                </select>
                                <button
                                    className="btn-gray slim"
                                    onClick={() => {
                                        setParkingQuery('');
                                        setParkingStatusFilter('all');
                                    }}
                                    style={{ marginTop: 0, height: '36px', display: 'inline-flex', alignItems: 'center', fontSize: '12px', padding: '4px 10px' }}
                                >
                                    Clear
                                </button>
                                <span style={{ fontSize: '11px', color: '#475569', fontWeight: 700, height: '36px', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                                    Showing {paginatedAreaSlots.length} / {selectedAreaFilteredSlots.length} (Page {safeParkingListPage}/{parkingListTotalPages})
                                </span>
                            </div>
                            <div className="table-wrap">
                                <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Slot</th>
                                    <th>Status</th>
                                    <th>Plate Number</th>
                                    <th>Sticker ID</th>
                                    <th>Entry Time</th>
                                    <th>Reserved For</th>
                                    <th>Reserved Sticker</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedAreaSlots.map(slot => {
                                    const displayStatus = getParkingDisplayStatus(slot);
                                    const reservationInfo = getReservationInfo(slot);
                                    const guestReservationWindow = isGuestReservationWindow(slot);

                                    return (
                                    <tr key={slot.id} style={{ background: selectedParkingSlotId === slot.id ? '#f0fdfa' : 'transparent' }}>
                                        <td>{slot.id}</td>
                                        <td>
                                            <span className={`status-badge ${displayStatus === 'Available' ? 'approved' : 'pending'}`}>
                                                {displayStatus}
                                            </span>
                                        </td>
                                        <td>{slot.plateNumber || '-'}</td>
                                        <td>{slot.stickerId || '-'}</td>
                                        <td>{slot.entryTime ? new Date(slot.entryTime).toLocaleString() : '-'}</td>
                                        <td>{slot.reservedFor ? new Date(slot.reservedFor).toLocaleString() : '-'}</td>
                                        <td>{slot.reservedStickerId || '-'}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                {slot.status === 'available' ? (
                                                    <>
                                                        {guestReservationWindow ? (
                                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap' }}>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Plate Number"
                                                                    value={parkGuestPlateInput}
                                                                    onChange={(e) => setParkGuestPlateInput(e.target.value)}
                                                                    style={{ width: '96px', height: '28px', fontSize: '12px', padding: '3px 7px', boxSizing: 'border-box' }}
                                                                />
                                                                <button
                                                                    className="btn-blue slim"
                                                                    onClick={() => handleTableParkVehicle(slot.id)}
                                                                    style={{ minWidth: '74px', height: '28px', marginTop: 0, fontSize: '12px', padding: '0 8px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                                                >
                                                                    Park Guest
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap' }}>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Sticker ID"
                                                                    value={parkStickerInput}
                                                                    onChange={(e) => setParkStickerInput(e.target.value)}
                                                                    style={{ width: '96px', height: '28px', fontSize: '12px', padding: '3px 7px', boxSizing: 'border-box' }}
                                                                />
                                                                <button
                                                                    className="btn-blue slim"
                                                                    onClick={() => handleTableParkVehicle(slot.id)}
                                                                    style={{ minWidth: '74px', height: '28px', marginTop: 0, fontSize: '12px', padding: '0 8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                                                >
                                                                    Park
                                                                </button>
                                                            </div>
                                                        )}
                                                        {reservationInfo?.isOverdue && (
                                                            <button
                                                                className="btn-red slim"
                                                                onClick={() => releaseOverdueReservation(slot.id)}
                                                                style={{ fontSize: '12px', padding: '4px 8px' }}
                                                            >
                                                                Release Expired
                                                            </button>
                                                        )}
                                                    </>
                                                ) : (
                                                    <button
                                                        className="btn-red slim"
                                                        onClick={() => leaveParking(slot.id)}
                                                        style={{ fontSize: '12px', padding: '4px 8px' }}
                                                    >
                                                        Leave
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                                </table>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                                <button
                                    className="btn-gray slim"
                                    onClick={() => setParkingListPage((prev) => Math.max(1, prev - 1))}
                                    disabled={safeParkingListPage === 1}
                                    style={{ marginTop: 0, opacity: safeParkingListPage === 1 ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                                >
                                    Prev
                                </button>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', minWidth: '82px', textAlign: 'center' }}>
                                    Page {safeParkingListPage} of {parkingListTotalPages}
                                </span>
                                <button
                                    className="btn-gray slim"
                                    onClick={() => setParkingListPage((prev) => Math.min(parkingListTotalPages, prev + 1))}
                                    disabled={safeParkingListPage === parkingListTotalPages}
                                    style={{ marginTop: 0, opacity: safeParkingListPage === parkingListTotalPages ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                </>)}

                {activeTab === 'logs' && isAdmin && (
                <>
                <div className="panel">
                    <h3>Parking Logs</h3>
                    {parkingLogs.length === 0 ? (
                        <p style={{ color: '#64748b' }}>No parking logs yet.</p>
                    ) : (
                        <div className="table-wrap">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Timestamp</th>
                                        <th>Event</th>
                                        <th>Slot</th>
                                        <th>Plate</th>
                                        <th>Sticker</th>
                                        <th>Actor</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedParkingLogs.map(log => (
                                        <tr key={log.id}>
                                            <td>{new Date(log.timestamp).toLocaleString()}</td>
                                            <td>{log.eventType}</td>
                                            <td>{log.slotId}</td>
                                            <td>{log.plateNumber || '-'}</td>
                                            <td>{log.stickerId || '-'}</td>
                                            <td>{log.actor || '-'}</td>
                                            <td>{log.notes || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {parkingLogs.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <button
                                className="btn-gray slim"
                                onClick={() => setLogsPage((prev) => Math.max(1, prev - 1))}
                                disabled={safeLogsPage === 1}
                                style={{ marginTop: 0, opacity: safeLogsPage === 1 ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                            >
                                Prev
                            </button>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', minWidth: '82px', textAlign: 'center' }}>
                                Page {safeLogsPage} of {logsTotalPages}
                            </span>
                            <button
                                className="btn-gray slim"
                                onClick={() => setLogsPage((prev) => Math.min(logsTotalPages, prev + 1))}
                                disabled={safeLogsPage === logsTotalPages}
                                style={{ marginTop: 0, opacity: safeLogsPage === logsTotalPages ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>
                </>)}

                {activeTab === 'accounts' && isRootAdmin && (
                <>
                <div className="panel">
                    <h3>Create Personnel Account</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <input type="text" placeholder="First Name" value={personnelFirstName} onChange={(e) => setPersonnelFirstName(e.target.value)} />
                        <input type="text" placeholder="Last Name" value={personnelLastName} onChange={(e) => setPersonnelLastName(e.target.value)} />
                        <input type="email" placeholder="Email" value={personnelEmail} onChange={(e) => setPersonnelEmail(e.target.value)} />
                        <input type="text" placeholder="Username" value={personnelUsername} onChange={(e) => setPersonnelUsername(e.target.value)} />
                        <input type="password" placeholder="Password" value={personnelPassword} onChange={(e) => setPersonnelPassword(e.target.value)} />
                        <select value={personnelRole} onChange={(e) => setPersonnelRole(e.target.value)}>
                            <option value="admin">Admin</option>
                            <option value="guard">Security Guard</option>
                        </select>
                    </div>
                    <div style={{ marginTop: '12px' }}>
                        <button className="btn-green" onClick={handleCreatePersonnelAccount}>Create Account</button>
                    </div>
                </div>
                </>)}

                    </div>
                </div>

            </div>
        </div>
    );
}