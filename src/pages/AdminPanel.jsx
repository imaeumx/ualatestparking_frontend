import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { usePopup } from '../components/PopupContext';
import PasswordField from '../components/PasswordField';
import { decryptDES } from '../utils/desCrypto';
import API_BASE_URL from '../config/api';
import ualogo from '../assets/ualogo.png';

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
    const VERIFY_KEY_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

    // UI state
    // activeTab chooses which major section is rendered.
    const [activeTab, setActiveTab] = useState('applications');
    const [applicationMiniTab, setApplicationMiniTab] = useState('pending');

    // Parking management state
    const [parkingSlots, setParkingSlots] = useState([]);
    const [parkStickerInputs, setParkStickerInputs] = useState({});
    const [parkGuestPlateInputs, setParkGuestPlateInputs] = useState({});
    const [selectedParkingAreaName, setSelectedParkingAreaName] = useState('Old Parking Space');
    const [selectedParkingSlotId, setSelectedParkingSlotId] = useState(null);
    const [parkingQuery, setParkingQuery] = useState('');
    const [parkingStatusFilter, setParkingStatusFilter] = useState('all');
    const [parkingListPage, setParkingListPage] = useState(1);
    const [applicationsPage, setApplicationsPage] = useState(1);
    const [applicationStatusFilter, setApplicationStatusFilter] = useState('all');
    const [applicationRoleFilter, setApplicationRoleFilter] = useState('all');
    const [reservationsPage, setReservationsPage] = useState(1);
    const [logsPage, setLogsPage] = useState(1);
    const [applicationModalOpen, setApplicationModalOpen] = useState(false);
    const [applicationModalRecord, setApplicationModalRecord] = useState(null);
    const [applicationModalNotes, setApplicationModalNotes] = useState('');
    const [isSavingApplicationEdit, setIsSavingApplicationEdit] = useState(false);

    // Reservation management state
    // pendingReservations stores all fetched reservations; mini-tab filters list view.
    // editing* states control inline admin edits (status + notes + save spinner).
    const [pendingReservations, setPendingReservations] = useState([]);
    const [reservationMiniTab, setReservationMiniTab] = useState('pending');
    const [editReservationStatus, setEditReservationStatus] = useState('pending');
    const [editReservationNotes, setEditReservationNotes] = useState('');
    const [isSavingReservationEdit, setIsSavingReservationEdit] = useState(false);
    const [parkingLogs, setParkingLogs] = useState([]);
    const [timeTick, setTimeTick] = useState(Date.now());
    const [showPersonnelNotif, setShowPersonnelNotif] = useState(false);
    const [personnelNotifItems, setPersonnelNotifItems] = useState([]);
    const [readPersonnelNotifKeys, setReadPersonnelNotifKeys] = useState([]);
    const [reasonModalOpen, setReasonModalOpen] = useState(false);
    const [reasonModalReservation, setReasonModalReservation] = useState(null);

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
        const matches = records.filter(r =>
            isStickerValidForCurrentSemester(r) &&
            (r.sticker_id || '').trim().toUpperCase() === normalizedStickerId
        );
        if (matches.length === 0) return null;

        // Prefer the most recent approved record in case of historical duplicate sticker IDs.
        const sortedMatches = matches.slice().sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
        return decryptData(sortedMatches[0].plate_number);
    };

    // Local alias used by existing table/render code.
    const decryptData = (ciphertext) => decryptDES(ciphertext);

    /**
     * Fetch all vehicle applications from the backend.
     * Updates local state and localStorage with valid stickers.
     */
    const fetchData = async () => {
        try {
            const res = await axios.get(`${API_BASE_URL}/admin-records/`, {
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
            const res = await axios.get(`${API_BASE_URL}/all-reservations/`, {
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

    useEffect(() => {
        if (pendingReservations.length === 0 || parkingSlots.length === 0) return;
        syncApprovedReservationsToSlots();
    }, [pendingReservations, parkingSlots.length, syncApprovedReservationsToSlots]);

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

    // Break the stored reservation reason into labeled fields so the popup can
    // present it as a proper form-style layout.
    const parseReservationReasonDetails = (reasonText) => {
        const normalizedReason = (reasonText || '').trim();
        if (!normalizedReason) {
            return { fields: [], extraText: '' };
        }

        const segments = normalizedReason
            .split('|')
            .map((segment) => segment.trim())
            .filter(Boolean);

        const labelMap = {
            category: 'Category',
            'plate number': 'Plate Number',
            org: 'Org Name',
            organization: 'Organization Name',
            event: 'Event Name',
            'activity form': 'Activity Form',
            requester: 'Name of Person Requesting Reservation',
            'requester name': 'Name of Person Requesting Reservation',
            position: 'Org Position',
            details: 'Detailed Reason'
        };

        const fields = [];
        const extraSegments = [];

        segments.forEach((segment) => {
            const separatorIndex = segment.indexOf(':');
            if (separatorIndex === -1) {
                extraSegments.push(segment);
                return;
            }

            const rawLabel = segment.slice(0, separatorIndex).trim();
            const rawValue = segment.slice(separatorIndex + 1).trim();

            if (!rawLabel || !rawValue) {
                extraSegments.push(segment);
                return;
            }

            fields.push({
                label: labelMap[rawLabel.toLowerCase()] || rawLabel,
                value: rawValue
            });
        });

        return {
            fields,
            extraText: extraSegments.join(' | ')
        };
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

    const syncApprovedReservationsToSlots = useCallback(() => {
        if (parkingSlots.length === 0) return;

        const approvedReservations = pendingReservations.filter(
            (reservation) => (reservation.status || '').toLowerCase() === 'approved'
        );
        const updatesBySlot = new Map();

        const getReservationPriority = (reservedAtIso) => {
            const reservedAt = new Date(reservedAtIso);
            if (Number.isNaN(reservedAt.getTime())) {
                return { rank: -1, timeValue: 0 };
            }

            const graceEnd = new Date(reservedAt.getTime() + 30 * 60 * 1000);
            if (new Date() > graceEnd) {
                return { rank: 3, timeValue: reservedAt.getTime() };
            }
            if (new Date() >= reservedAt) {
                return { rank: 2, timeValue: reservedAt.getTime() };
            }
            return { rank: 1, timeValue: -reservedAt.getTime() };
        };

        approvedReservations.forEach((reservation) => {
            const reservedSticker = (reservation.sticker_id || '').trim().toUpperCase();
            const reservedFor = reservation.reserved_for_datetime || null;
            const nextPriority = getReservationPriority(reservedFor);
            const normalizedSpots = parseReservationSpots(reservation);

            normalizedSpots.forEach((spotId) => {
                const current = updatesBySlot.get(spotId);
                const shouldReplace = !current
                    || nextPriority.rank > current.priority.rank
                    || (nextPriority.rank === current.priority.rank && nextPriority.timeValue > current.priority.timeValue);
                if (!shouldReplace) return;
                updatesBySlot.set(spotId, {
                    reservedFor,
                    reservedStickerId: reservedSticker,
                    priority: nextPriority
                });
            });
        });

        let changed = false;
        const syncedSlots = parkingSlots.map((slot) => {
            if (slot.status === 'occupied') return slot;
            const update = updatesBySlot.get(slot.id);
            if (update) {
                if (slot.reservedFor !== update.reservedFor || slot.reservedStickerId !== update.reservedStickerId) {
                    changed = true;
                    return {
                        ...slot,
                        reservedFor: update.reservedFor,
                        reservedStickerId: update.reservedStickerId
                    };
                }
                return slot;
            }
            if (slot.reservedFor || slot.reservedStickerId) {
                changed = true;
                return {
                    ...slot,
                    reservedFor: null,
                    reservedStickerId: ''
                };
            }
            return slot;
        });

        if (changed) {
            setParkingSlots(syncedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(syncedSlots));
        }
    }, [parkingSlots, pendingReservations]);

    // Start inline edit mode for one reservation row.
    const beginReservationEdit = (reservation) => {
        setEditReservationStatus((reservation.status || 'pending').toLowerCase());
        setEditReservationNotes((reservation.admin_notes || '').trim());
    };

    // Cancel edit mode and reset temporary fields.
    const cancelReservationEdit = () => {
        setEditReservationStatus('pending');
        setEditReservationNotes('');
    };

    const handleReasonModalDecision = async (nextStatus) => {
        if (!reasonModalReservation) return;

        try {
            setIsSavingReservationEdit(true);
            const payload = {
                reservation_id: reasonModalReservation.id,
                status: (nextStatus || 'pending').toLowerCase(),
                admin_notes: (editReservationNotes || '').trim(),
                requester_username: currentUser.username,
                auth_token: currentUser.authToken || ''
            };

            const response = await axios.post(`${API_BASE_URL}/update-reservation-admin/`, payload);
            if (response.data.status === 'success') {
                applyReservationToSlots(reasonModalReservation, payload.status);
                showInfo(`Reservation ${payload.status} successfully`);
                setReasonModalOpen(false);
                setReasonModalReservation(null);
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
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
     * Update application status (Approve/Reject/Reopen).
     * Triggers backend update and refreshes data.
     */
    const handleUpdateStatus = async (id, status, adminNotes = '') => {
        try {
            await axios.post(`${API_BASE_URL}/update-status/`, {
                id,
                status,
                admin_notes: (adminNotes || '').trim(),
                requester_username: currentUser.username,
                auth_token: currentUser.authToken || ''
            });
            fetchData();
            return true;
        } catch (err) {
            showError(err?.response?.data?.message || 'Update failed');
            return false;
        }
    };

    const openApplicationModal = (record) => {
        setApplicationModalRecord(record);
        setApplicationModalNotes((record?.admin_notes || '').trim());
        setApplicationModalOpen(true);
    };

    const closeApplicationModal = () => {
        setApplicationModalOpen(false);
        setApplicationModalRecord(null);
        setApplicationModalNotes('');
        setIsSavingApplicationEdit(false);
    };

    const handleApplicationModalDecision = async (nextStatus) => {
        if (!applicationModalRecord) return;

        const normalizedStatus = (nextStatus || '').toLowerCase();
        const trimmedNotes = (applicationModalNotes || '').trim();

        // Require context for rejections so the applicant can see why it was declined.
        if (normalizedStatus === 'rejected' && !trimmedNotes) {
            showError('Please add notes before rejecting an application.');
            return;
        }

        try {
            setIsSavingApplicationEdit(true);
            const saved = await handleUpdateStatus(applicationModalRecord.id, nextStatus, trimmedNotes);
            if (saved) {
                closeApplicationModal();
                showInfo(`Application ${normalizedStatus} successfully`);
            }
        } catch (err) {
            showError(err?.response?.data?.message || 'Update failed');
        } finally {
            setIsSavingApplicationEdit(false);
        }
    };

    // Sticker verification handlers
    const handleVerify = () => { setActiveVerify(verifyInput.trim().toUpperCase()); };
    const clearVerify = () => { setVerifyInput(''); setActiveVerify(''); };

    const handleVerifySecretKey = () => {
        // Manual key gate for personnel users to reveal DES-decrypted values.
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
        const isRootAdminActor = (currentUser.role || '').toLowerCase() === 'root_admin';
        const actorFirstName = (currentUser.firstName || currentUser.first_name || '').trim();
        const actorLastName = (currentUser.lastName || currentUser.last_name || '').trim();
        const actorName = isRootAdminActor
            ? 'rootadmin'
            : `${actorFirstName} ${actorLastName}`.trim() || currentUser.username || 'personnel';

        const nextLog = {
            id: `${Date.now()}-${slot.id}`,
            timestamp: new Date().toISOString(),
            eventType,
            slotId: slot.id,
            plateNumber: slot.plateNumber || '',
            stickerId: slot.stickerId || '',
            actor: actorName,
            notes
        };

        const updatedLogs = [nextLog, ...parkingLogs].slice(0, 300);
        setParkingLogs(updatedLogs);
        localStorage.setItem('parkingLogs', JSON.stringify(updatedLogs));
    };

    const getParkingLogLabel = (eventType) => {
        const normalizedEvent = (eventType || '').toLowerCase();
        if (normalizedEvent === 'reservation_release') return 'Reservation Release';
        if (normalizedEvent === 'park') return 'Park';
        if (normalizedEvent === 'release') return 'Checkout';
        return (eventType || '-').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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
    const releaseOverdueReservation = async (slotId) => {
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

        // 1. Locate the formal backend reservation matching this slot marker
        const matchingReservation = pendingReservations.find(res => {
            if ((res.status || '').toLowerCase() !== 'approved') return false;
            
            // Match exactly same reservation time to avoid pulling wrong ones
            const resTime = new Date(res.reserved_for_datetime).getTime();
            const slotTime = new Date(targetSlot.reservedFor).getTime();
            if (resTime !== slotTime) return false;
            
            // Validate spot is claimed by this reservation
            const spots = parseReservationSpots(res);
            return spots.includes(slotId);
        });

        if (matchingReservation) {
            try {
                await axios.post(`${API_BASE_URL}/update-reservation-admin/`, {
                    reservation_id: matchingReservation.id,
                    status: 'cancelled',
                    admin_notes: 'Released overdue reservation by personnel.',
                    requester_username: currentUser.username,
                    auth_token: currentUser.authToken || ''
                });
            } catch (err) {
                showError(err?.response?.data?.message || 'Failed to update reservation status.');
                return;
            }

            const updatedSlots = parkingSlots.map(slot => 
                slot.id === slotId
                    ? { ...slot, reservedFor: null, reservedStickerId: '' }
                    : slot
            );

            setParkingSlots(updatedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));

            fetchPendingReservations();
            addParkingLog('reservation_release', targetSlot, 'Released overdue reservation and cancelled it in backend.');
            showInfo(`Spot ${slotId} released.`);
            return;
        }

        // Fallback: If we couldn't resolve exactly which reservations matched, safely clear just this slot
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
            const response = await axios.post(`${API_BASE_URL}/create-personnel-account/`, {
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
    }, [parkingSlots, timeTick, showInfo]);

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
            const guestPlateInput = (parkGuestPlateInputs[slotId] || '').trim();
            if (!guestPlateInput) {
                showError('Enter plate number for guest/event parking.');
                return;
            }
            if (parkGuestVehicle(slotId, guestPlateInput)) {
                setParkGuestPlateInputs((prev) => ({ ...prev, [slotId]: '' }));
            }
            return;
        }

        const stickerInput = (parkStickerInputs[slotId] || '').trim();
        if (!stickerInput) {
            showError('Please enter a sticker ID first');
            return;
        }
        
        const sticker = stickerInput.toUpperCase();
        const validStickers = getValidStickers();
        if (validStickers.includes(sticker)) {
            const plateNumber = getPlateFromSticker(sticker);
            if (plateNumber) {
                parkVehicle(slotId, plateNumber, sticker);
                setParkStickerInputs((prev) => ({ ...prev, [slotId]: '' }));
            } else {
                showError('Could not find plate number for this sticker ID');
            }
        } else {
            showError(`Invalid sticker ID. Valid approved stickers: ${validStickers.join(', ')}`);
        }
    };

    // Dashboard counters and derived table lists.
    const pendingCount = records.filter(r => r.status === 'Pending').length;
    const pendingApplicationCount = pendingCount;
    const allApplicationCount = records.length;
    const approvedCount = records.filter(r => r.status === 'Approved').length;
    const totalRevenue = records.filter(r => r.status === 'Approved')
                                .reduce((acc, curr) => acc + getFee(curr.vehicle_type), 0);
    const pendingReservationRows = pendingReservations.filter(
        (reservation) => (reservation.status || '').toLowerCase() === 'pending'
    );
    const pendingReservationCount = pendingReservationRows.length;
    const reviewedReservationRows = pendingReservations.filter(
        (reservation) => ['approved', 'denied'].includes((reservation.status || '').toLowerCase())
    );
    const allReservationCount = reviewedReservationRows.length;
    const displayedReservationRows = reservationMiniTab === 'pending' ? pendingReservationRows : reviewedReservationRows;

    const APPLICATIONS_PAGE_SIZE = 20;
    const RESERVATIONS_PAGE_SIZE = 20;
    const LOGS_PAGE_SIZE = 20;

    // Root admin can always view plaintext; other personnel require secret-key unlock.
    const canViewVerifyDecrypted = isRootAdmin || hasValidVerifyKey;
    const getSensitiveText = (cipherText) => {
        const normalizedValue = cipherText == null ? '' : String(cipherText);
        if (!normalizedValue) return '---';
        return canViewVerifyDecrypted ? decryptData(normalizedValue) : normalizedValue;
    };

    const filteredApplicationRows = records
        .filter((record) => {
            if (activeVerify) return record.sticker_id === activeVerify;
            const plateMatch = getSensitiveText(record.plate_number).toLowerCase().includes(search);
            const normalizedRole = (record.role || '').toLowerCase();
            const isNonStudent = normalizedRole === 'guest' || normalizedRole === 'non-student';
            const roleValue = isNonStudent ? 'non-student' : 'student';
            const roleMatch = applicationRoleFilter === 'all' ? true : roleValue === applicationRoleFilter;
            const statusMatch = applicationStatusFilter === 'all'
                ? true
                : (record.status || '').toLowerCase() === applicationStatusFilter.toLowerCase();
            return plateMatch && roleMatch && statusMatch;
        })
        .slice()
        .reverse();
    const displayedApplicationRows = applicationMiniTab === 'pending'
        ? filteredApplicationRows.filter((record) => (record.status || '').toLowerCase() === 'pending')
        : filteredApplicationRows.filter((record) => {
            const normalizedStatus = (record.status || '').toLowerCase();
            return normalizedStatus === 'approved' || normalizedStatus === 'rejected';
        });
    const applicationsTotalPages = Math.max(1, Math.ceil(displayedApplicationRows.length / APPLICATIONS_PAGE_SIZE));
    const safeApplicationsPage = Math.min(applicationsPage, applicationsTotalPages);
    const paginatedApplicationRows = displayedApplicationRows.slice(
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
    }, [search, activeVerify, applicationMiniTab, applicationStatusFilter, applicationRoleFilter]);

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

    useEffect(() => {
        if (!hasValidVerifyKey) return undefined;

        let relockTimer = null;
        const activityEvents = ['mousedown', 'keydown', 'mousemove', 'scroll', 'touchstart'];

        const resetRelockTimer = () => {
            if (relockTimer) {
                clearTimeout(relockTimer);
            }

            // Auto-lock decrypted view after inactivity to reduce accidental sensitive data exposure.
            relockTimer = setTimeout(() => {
                setHasValidVerifyKey(false);
                showInfo('No activity for 2 minutes. Decrypted view locked again.');
            }, VERIFY_KEY_IDLE_TIMEOUT_MS);
        };

        activityEvents.forEach((eventName) => {
            window.addEventListener(eventName, resetRelockTimer);
        });

        // Start idle countdown immediately after successful unlock.
        resetRelockTimer();

        return () => {
            if (relockTimer) {
                clearTimeout(relockTimer);
            }
            activityEvents.forEach((eventName) => {
                window.removeEventListener(eventName, resetRelockTimer);
            });
        };
    }, [hasValidVerifyKey, showInfo, VERIFY_KEY_IDLE_TIMEOUT_MS]);

    return (
        <div className="center dashboard-bg full-bleed-layout">
            <div className="card admin-large-card full-bleed-card">
                <div className="header-banner">
                    <img src={ualogo} alt="UA Logo" />
                    <div>
                        <div className="brand-title">University of the Assumption</div>
                        <div className="brand-subtitle">UA Personnel Portal</div>
                    </div>
                </div>

                {/* TOPBAR */}
                <div className="topbar">
                    <div className="welcome-row">
                        <h2 style={{ margin: 0 }}>UA Personnel Management</h2>
                        <p className="subtitle" style={{ margin: 0 }}>
                            Role: {isRootAdmin ? 'ROOT ADMIN' : isAdmin ? 'ADMIN' : 'SECURITY GUARD'}
                        </p>
                    </div>
                    
                    <div className="topbar-actions">
                        <button className="btn-gray slim bell-btn" onClick={() => setShowPersonnelNotif(!showPersonnelNotif)}>
                            🔔
                            {unreadPersonnelNotifCount > 0 && <span className="notif-count">{unreadPersonnelNotifCount}</span>}
                        </button>

                        {showPersonnelNotif && (
                            <div className="notif-dropdown" style={{ minWidth: '320px' }}>
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
                                    <button className="link-btn mark-read" onClick={markPersonnelNotifsAsRead}>
                                        Mark as Read
                                    </button>
                                )}
                            </div>
                        )}

                        <button className="btn-blue slim" onClick={() => navigate('/')}>
                            Logout
                        </button>
                    </div>
                </div>

                {/* TABS */}
                <div className="admin-layout">
                    <div className="admin-tabs">
                        {isAdmin && (
                            <button
                                className={`tab-button ${activeTab === 'applications' ? 'active' : ''}`}
                                onClick={() => setActiveTab('applications')}
                            >
                                Applications ({pendingApplicationCount})
                            </button>
                        )}
                        {isAdmin && (
                            <button
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
                            className={`tab-button ${activeTab === 'parking' ? 'active' : ''}`}
                            onClick={() => setActiveTab('parking')}
                        >
                            Parking Management
                        </button>
                        {isAdmin && (
                            <button
                                className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`}
                                onClick={() => setActiveTab('logs')}
                            >
                                Parking Logs
                            </button>
                        )}
                        {isRootAdmin && (
                            <button
                                className={`tab-button ${activeTab === 'accounts' ? 'active' : ''}`}
                                onClick={() => setActiveTab('accounts')}
                            >
                                Personnel Accounts
                            </button>
                        )}
                        <button
                            className={`tab-button ${activeTab === 'verify' ? 'active' : ''}`}
                            onClick={() => setActiveTab('verify')}
                        >
                            Verify Sticker
                        </button>
                        {activeTab === 'parking' && (
                            <div style={{ marginTop: '8px', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '10px', background: '#f8fafc' }}>
                                <h4 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: '0.9rem' }}>Parking Map</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {parkingAreas.map((area) => {
                                        const isActive = selectedParkingAreaName === area.name;
                                        return (
                                            <button
                                                key={`sidebar-parking-area-${area.name}`}
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

                    <div className="admin-main">
                        <div style={{ marginTop: '0' }}>
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
                                <h3 style={{ margin: 0, width: '100%', textAlign: 'left', alignSelf: 'flex-start' }}>Application Records</h3>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'nowrap' }}>
                                    <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap', minWidth: 0 }}>
                                        <button
                                            type="button"
                                            className={`tab-button ${applicationMiniTab === 'pending' ? 'active' : ''}`}
                                            onClick={() => setApplicationMiniTab('pending')}
                                            style={{ marginTop: 0, padding: '6px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                                        >
                                            Pending Applications ({pendingApplicationCount})
                                        </button>
                                        <button
                                            type="button"
                                            className={`tab-button ${applicationMiniTab === 'all' ? 'active' : ''}`}
                                            onClick={() => setApplicationMiniTab('all')}
                                            style={{ marginTop: 0, padding: '6px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                                        >
                                            All Applications ({allApplicationCount})
                                        </button>
                                    </div>
                                    <div className="filter-controls" style={{ justifyContent: 'flex-end', display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                                        {!isRootAdmin && (
                                            <>
                                                <PasswordField
                                                    value={verifySecretKeyInput}
                                                    onChange={(e) => setVerifySecretKeyInput(e.target.value)}
                                                    placeholder="Enter Secret Key"
                                                    wrapperStyle={{ maxWidth: '180px', flex: '0 0 180px' }}
                                                    inputStyle={{ width: '100%' }}
                                                />
                                                <button
                                                    type="button"
                                                    className="btn-gray slim"
                                                    onClick={handleVerifySecretKey}
                                                    style={{ marginTop: 0 }}
                                                >
                                                    Unlock
                                                </button>
                                            </>
                                        )}
                                        <select
                                            value={applicationStatusFilter}
                                            onChange={(e) => setApplicationStatusFilter(e.target.value)}
                                            style={{ maxWidth: '140px', height: '36px', fontSize: '12px', padding: '6px 10px', flex: '0 0 140px' }}
                                        >
                                            <option value="all">All Status</option>
                                            <option value="pending">Pending</option>
                                            <option value="approved">Approved</option>
                                            <option value="rejected">Rejected</option>
                                        </select>
                                        <select
                                            value={applicationRoleFilter}
                                            onChange={(e) => setApplicationRoleFilter(e.target.value)}
                                            style={{ maxWidth: '160px', height: '36px', fontSize: '12px', padding: '6px 10px', flex: '0 0 160px' }}
                                        >
                                            <option value="all">All Roles</option>
                                            <option value="student">Student</option>
                                            <option value="non-student">Non-Student</option>
                                        </select>
                                        <input type="text" className="table-filter" placeholder="Search Plate..." onChange={(e) => setSearch(e.target.value.toLowerCase())} onKeyDown={handleSearchKeyPress} style={{ flex: '0 0 180px' }} />
                                    </div>
                                </div>
                            </div>

                            {displayedApplicationRows.length === 0 ? (
                                <p style={{ color: '#64748b' }}>
                                    {applicationMiniTab === 'pending' ? 'No pending applications found' : 'No applications found'}
                                </p>
                            ) : (
                            <div className="table-wrap">
                                <table className="data-table" style={{ tableLayout: 'fixed', fontSize: '12px' }}>
                                    <thead>
                                        <tr>
                                            <th>Owner Name</th>
                                            <th>Role & Details</th>
                                            <th>Plate Number</th>
                                            <th>Sticker ID</th>
                                            <th>Type</th>
                                            <th>Payment</th>
                                            <th>Expires</th>
                                            <th>Status</th>
                                            <th style={{ width: '220px' }}>
                                                Notes
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedApplicationRows.map((v) => {
                                            return (
                                            <tr key={v.id}>
                                                <td style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={getSensitiveText(v.owner_name)}>{getSensitiveText(v.owner_name)}</td>
                                        
                                        {/* ROLE INFO COLUMN */}
                                        <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.identifier || 'N/A'}>
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

                                        <td className="bold-plate" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={getSensitiveText(v.plate_number)}>{getSensitiveText(v.plate_number)}</td>
                                        <td className="sticker-id-text" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.sticker_id || '---'}>{v.sticker_id || '---'}</td>
                                        <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={v.vehicle_type}>{v.vehicle_type}</td>
                                        <td style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`₱${getFee(v.vehicle_type).toLocaleString()} | ${v.payment_method || '---'} | ${v.payment_reference || '---'}`}>
                                            ₱{getFee(v.vehicle_type).toLocaleString()} | {v.payment_method || '---'}
                                        </td>
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
                                        <td style={{ width: '220px', textAlign: 'left', verticalAlign: 'middle', paddingLeft: '12px' }}>
                                            <span
                                                onClick={() => openApplicationModal(v)}
                                                title={(v.admin_notes || '').trim() || 'Add a note...'}
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    color: '#000000',
                                                    cursor: 'pointer',
                                                    display: 'inline-block',
                                                    textAlign: 'left',
                                                    maxWidth: '100%',
                                                    lineHeight: 1.1,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis'
                                                }}
                                            >
                                                {(v.admin_notes || '').trim() || 'Add a note...'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            </tbody>
                        </table>
                    </div>
                    )}
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
                    {/* Admin review modal for a single sticker application. */}
                    {applicationModalOpen && applicationModalRecord && (
                        <div style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 1100,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(15, 23, 42, 0.55)',
                            padding: '16px'
                        }} onClick={closeApplicationModal}>
                            <div style={{
                                width: '100%',
                                maxWidth: '760px',
                                background: '#ffffff',
                                borderRadius: '16px',
                                boxShadow: '0 24px 60px rgba(15, 23, 42, 0.25)',
                                border: '1px solid #e2e8f0',
                                padding: '28px',
                                position: 'relative',
                                maxHeight: '90vh',
                                overflowY: 'auto'
                            }} className="reservation-modal-scroll" onClick={(event) => event.stopPropagation()}>
                                <button
                                    type="button"
                                    onClick={closeApplicationModal}
                                    style={{
                                        position: 'absolute',
                                        top: '18px',
                                        right: '18px',
                                        width: '36px',
                                        height: '36px',
                                        border: 'none',
                                        borderRadius: '999px',
                                        background: '#f8fafc',
                                        display: 'grid',
                                        placeItems: 'center',
                                        fontSize: '18px',
                                        lineHeight: 1,
                                        cursor: 'pointer',
                                        color: '#475569',
                                        boxShadow: '0 6px 14px rgba(15, 23, 42, 0.12)'
                                    }}
                                    aria-label="Close application modal"
                                >
                                    ✕
                                </button>
                                <h3 style={{ margin: '0 0 16px', color: '#0f172a', textAlign: 'center' }}>Application Notes</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Owner Name</label>
                                        <input type="text" value={getSensitiveText(applicationModalRecord.owner_name)} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Status</label>
                                        <input type="text" value={(applicationModalRecord.status || 'Pending').toUpperCase()} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                    </div>
                                </div>

                                {(() => {
                                    // Parse identifier shape so modal fields stay readable for both student and non-student users.
                                    const applicationRoleValue = (applicationModalRecord.role || '---').toString();
                                    const normalizedApplicationRole = applicationRoleValue.toLowerCase();
                                    const isStudentApplication = normalizedApplicationRole === 'student';
                                    const applicationIdentifierText = (applicationModalRecord.identifier || '').trim();
                                    const identifierParts = applicationIdentifierText.split('|').map((part) => part.trim()).filter(Boolean);
                                    const studentIdValue = isStudentApplication ? (identifierParts[0] || '---') : '---';
                                    const schoolTrackValue = isStudentApplication ? (identifierParts[1] || '---') : '---';

                                    return (
                                        <>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>User Type</label>
                                                    <input
                                                        type="text"
                                                        value={isStudentApplication ? 'Student' : 'Non-Student'}
                                                        disabled
                                                        style={{ background: '#f8fafc', color: '#334155' }}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Identifier</label>
                                                    <input
                                                        type="text"
                                                        value={applicationIdentifierText || '---'}
                                                        disabled
                                                        style={{ background: '#f8fafc', color: '#334155' }}
                                                    />
                                                </div>
                                            </div>

                                            {isStudentApplication ? (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Student ID</label>
                                                        <input type="text" value={studentIdValue} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>College / SHS Strand or Course</label>
                                                        <input type="text" value={schoolTrackValue} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ marginBottom: '12px' }}>
                                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Non-Student Purpose</label>
                                                    <input type="text" value={applicationIdentifierText || '---'} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Plate Number</label>
                                        <input type="text" value={getSensitiveText(applicationModalRecord.plate_number)} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Sticker ID</label>
                                        <input type="text" value={applicationModalRecord.sticker_id || '---'} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                    </div>
                                </div>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>Notes</label>
                                    <textarea
                                        value={applicationModalNotes}
                                        onChange={(e) => setApplicationModalNotes(e.target.value)}
                                        rows={4}
                                        placeholder="Add a note here, especially when rejecting an application"
                                        style={{
                                            width: '100%',
                                            maxWidth: '100%',
                                            boxSizing: 'border-box',
                                            resize: 'vertical',
                                            overflowY: 'auto'
                                        }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button
                                        type="button"
                                        className="btn-red"
                                        onClick={() => handleApplicationModalDecision('Rejected')}
                                        disabled={isSavingApplicationEdit}
                                        style={{ flex: 1, marginTop: 0, opacity: isSavingApplicationEdit ? 0.7 : 1 }}
                                    >
                                        Reject
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-green"
                                        onClick={() => handleApplicationModalDecision('Approved')}
                                        disabled={isSavingApplicationEdit}
                                        style={{ flex: 1, marginTop: 0, opacity: isSavingApplicationEdit ? 0.7 : 1 }}
                                    >
                                        Approve
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
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
                        {!isRootAdmin && (
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                                <PasswordField
                                    value={verifySecretKeyInput}
                                    onChange={(e) => setVerifySecretKeyInput(e.target.value)}
                                    placeholder="Enter Secret Key"
                                    wrapperStyle={{ width: '360px', maxWidth: '360px' }}
                                    inputStyle={{ textAlign: 'left', fontSize: '14px', padding: '10px 12px', width: '100%', height: '36px' }}
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
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Reservation Date</th>
                                        {reservationMiniTab === 'all' && (
                                            <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedReservationRows.map((res) => {
                                        const reasonText = (res.reservation_reason || '').trim() || 'No reason provided';
                                        const statusText = (res.status || 'pending').toLowerCase();
                                        const statusColor = statusText === 'approved'
                                            ? '#10b981'
                                            : statusText === 'denied'
                                                ? '#ef4444'
                                                : '#64748b';
                                        const statusBg = statusText === 'approved'
                                            ? '#d1fae5'
                                            : statusText === 'denied'
                                                ? '#fee2e2'
                                                : '#f1f5f9';
                                        return (
                                        <tr key={res.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                            <td style={{ padding: '10px', maxWidth: '140px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{res.applicant_username}</td>
                                            <td style={{ padding: '10px', fontWeight: 600, maxWidth: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{res.sticker_id || 'N/A'}</td>
                                            <td style={{ padding: '10px', maxWidth: '160px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>
                                                {parseReservationSpots(res).join(', ') || '---'}
                                            </td>
                                            <td style={{ padding: '10px', fontSize: '12px', maxWidth: '420px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        beginReservationEdit(res);
                                                        setReasonModalReservation(res);
                                                        setReasonModalOpen(true);
                                                    }}
                                                    style={{
                                                        margin: 0,
                                                        padding: 0,
                                                        width: '100%',
                                                        border: 'none',
                                                        background: 'transparent',
                                                        color: '#334155',
                                                        textAlign: 'left',
                                                        fontSize: '12px',
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        cursor: 'pointer'
                                                    }}
                                                    title={reasonText}
                                                >
                                                    {reasonText}
                                                </button>
                                            </td>
                                            <td style={{ padding: '10px', fontSize: '12px', maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>
                                                {new Date(res.reserved_for_datetime).toLocaleString()}
                                            </td>
                                            {reservationMiniTab === 'all' && (
                                                <td style={{ padding: '10px', textAlign: 'left' }}>
                                                    <span style={{
                                                        display: 'inline-block',
                                                        padding: '4px 8px',
                                                        borderRadius: '999px',
                                                        background: statusBg,
                                                        color: statusColor,
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.04em'
                                                    }}>
                                                        {statusText}
                                                    </span>
                                                </td>
                                            )}
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {/* Reservation details modal for approve/deny decisions and post-review updates. */}
                    {reasonModalOpen && reasonModalReservation && (
                        <div style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 1100,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(15, 23, 42, 0.55)',
                            padding: '16px'
                        }} onClick={() => {
                            setReasonModalOpen(false);
                            setReasonModalReservation(null);
                            cancelReservationEdit();
                        }}>
                            <div style={{
                                width: '100%',
                                maxWidth: '940px',
                                background: '#ffffff',
                                borderRadius: '16px',
                                boxShadow: '0 24px 60px rgba(15, 23, 42, 0.25)',
                                border: '1px solid #e2e8f0',
                                padding: '28px',
                                position: 'relative',
                                maxHeight: '90vh',
                                overflowY: 'auto'
                            }} className="reservation-modal-scroll" onClick={(event) => event.stopPropagation()}>
                                {(() => {
                                    // Decode structured reason text (Category | Plate | Event...) into labeled display fields.
                                    const reasonDetails = parseReservationReasonDetails(reasonModalReservation.reservation_reason);
                                    const getFieldValue = (...labels) => {
                                        const normalizedLookup = labels.map((label) => label.toLowerCase());
                                        const match = reasonDetails.fields.find((field) => normalizedLookup.includes(field.label.toLowerCase()));
                                        return match ? match.value : '---';
                                    };
                                    const currentModalStatus = (reasonModalReservation.status || 'pending').toLowerCase();
                                    const isReviewedStatus = currentModalStatus === 'approved' || currentModalStatus === 'denied';
                                    const userValue = reasonModalReservation.applicant_username || '---';
                                    const stickerValue = reasonModalReservation.sticker_id || 'N/A';
                                    const spotsValue = parseReservationSpots(reasonModalReservation).join(', ') || '---';
                                    const reservedForValue = reasonModalReservation.reserved_for_datetime ? new Date(reasonModalReservation.reserved_for_datetime).toLocaleString() : '---';

                                    return (
                                        <>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setReasonModalOpen(false);
                                        setReasonModalReservation(null);
                                        cancelReservationEdit();
                                    }}
                                    style={{
                                        position: 'absolute',
                                        top: '18px',
                                        right: '18px',
                                        width: '36px',
                                        height: '36px',
                                        border: 'none',
                                        borderRadius: '999px',
                                        background: '#f8fafc',
                                        display: 'grid',
                                        placeItems: 'center',
                                        fontSize: '18px',
                                        lineHeight: 1,
                                        cursor: 'pointer',
                                        color: '#475569',
                                        boxShadow: '0 6px 14px rgba(15, 23, 42, 0.12)'
                                    }}
                                    aria-label="Close reason modal"
                                >
                                    ✕
                                </button>
                                <h3 style={{ margin: '0 0 12px', color: '#0f172a', textAlign: 'center' }}>Reservation Details</h3>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                        User
                                    </label>
                                    <input type="text" value={userValue} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                </div>

                                <div style={{ marginBottom: '12px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                        Sticker ID
                                    </label>
                                    <input type="text" value={stickerValue} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Spot/s
                                        </label>
                                        <input type="text" value={spotsValue} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Reservation Date
                                        </label>
                                        <input type="text" value={reservedForValue} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                    </div>
                                </div>

                                {reasonDetails.fields.length > 0 ? (
                                    <>
                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                                Reason Category
                                            </label>
                                            <input type="text" value={getFieldValue('Category', 'Reason Category')} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                        </div>

                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                                Plate Number
                                            </label>
                                            <input type="text" value={getFieldValue('Plate Number')} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                        </div>

                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                                Org Name
                                            </label>
                                            <input type="text" value={getFieldValue('Org Name', 'Organization Name')} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                                    Event Name
                                                </label>
                                                <input type="text" value={getFieldValue('Event Name')} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                                    Activity Form
                                                </label>
                                                <input type="text" value={getFieldValue('Activity Form', 'Activity Form No.')} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                                    Name of Person Requesting Reservation
                                                </label>
                                                <input type="text" value={getFieldValue('Name of Person Requesting Reservation', 'Requester', 'Requester Name')} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                                    Org Position
                                                </label>
                                                <input type="text" value={getFieldValue('Org Position', 'Position')} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                            </div>
                                        </div>

                                        <div style={{ marginBottom: '12px' }}>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                                Detailed Reason
                                            </label>
                                            <textarea
                                                value={reasonDetails.extraText || getFieldValue('Detailed Reason', 'Details') || (reasonModalReservation.reservation_reason || '').trim() || 'No reason provided'}
                                                disabled
                                                rows={4}
                                                style={{
                                                    width: '100%',
                                                    maxWidth: '100%',
                                                    boxSizing: 'border-box',
                                                    resize: 'vertical',
                                                    overflowY: 'auto',
                                                    background: '#f8fafc',
                                                    color: '#334155'
                                                }}
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ marginBottom: '12px' }}>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                            Reason
                                        </label>
                                        <textarea
                                            value={(reasonModalReservation.reservation_reason || '').trim() || 'No reason provided'}
                                            disabled
                                            rows={4}
                                            style={{
                                                width: '100%',
                                                maxWidth: '100%',
                                                boxSizing: 'border-box',
                                                resize: 'vertical',
                                                overflowY: 'auto',
                                                background: '#f8fafc',
                                                color: '#334155'
                                            }}
                                        />
                                    </div>
                                )}

                                <div style={{ marginBottom: '14px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                        Status
                                    </label>
                                    {isReviewedStatus ? (
                                        <select
                                            value={editReservationStatus}
                                            onChange={(e) => setEditReservationStatus((e.target.value || '').toLowerCase())}
                                        >
                                            <option value="approved">Approved</option>
                                            <option value="denied">Denied</option>
                                        </select>
                                    ) : (
                                        <input type="text" value={(reasonModalReservation.status || 'pending').toUpperCase()} disabled style={{ background: '#f8fafc', color: '#334155' }} />
                                    )}
                                </div>

                                {/* Pending reservations expose quick approve/deny actions; reviewed rows use Save Changes below. */}
                                {!isReviewedStatus && (
                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
                                        <button
                                            type="button"
                                            className="btn-red"
                                            onClick={() => handleReasonModalDecision('denied')}
                                            disabled={isSavingReservationEdit}
                                            style={{ flex: 1, marginTop: 0, opacity: isSavingReservationEdit ? 0.7 : 1 }}
                                        >
                                            Deny
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-green"
                                            onClick={() => handleReasonModalDecision('approved')}
                                            disabled={isSavingReservationEdit}
                                            style={{ flex: 1, marginTop: 0, opacity: isSavingReservationEdit ? 0.7 : 1 }}
                                        >
                                            Approve
                                        </button>
                                    </div>
                                )}

                                <div style={{ marginBottom: '14px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                        Admin Notes
                                    </label>
                                    <textarea
                                        value={editReservationNotes}
                                        onChange={(e) => setEditReservationNotes(e.target.value)}
                                        placeholder="Add note before approving/denying..."
                                        rows={3}
                                        style={{
                                            width: '100%',
                                            maxWidth: '100%',
                                            boxSizing: 'border-box',
                                            resize: 'vertical',
                                            overflowY: 'auto'
                                        }}
                                    />
                                </div>

                                {isReviewedStatus && (
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <button
                                            type="button"
                                            className="btn-blue slim"
                                            onClick={() => handleReasonModalDecision(editReservationStatus)}
                                            disabled={isSavingReservationEdit}
                                            style={{ marginTop: 0, minWidth: '160px', opacity: isSavingReservationEdit ? 0.7 : 1 }}
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                )}
                                        </>
                                    );
                                })()}
                            </div>
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
                        <div style={{ flex: '1 1 100%', minWidth: 0, overflowX: 'auto' }}>
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
                                                                    value={parkGuestPlateInputs[slot.id] || ''}
                                                                    onChange={(e) => setParkGuestPlateInputs((prev) => ({ ...prev, [slot.id]: e.target.value }))}
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
                                                                    value={parkStickerInputs[slot.id] || ''}
                                                                    onChange={(e) => setParkStickerInputs((prev) => ({ ...prev, [slot.id]: e.target.value }))}
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
                                        <th>Sticker/Plate Number</th>
                                        <th>Actor</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedParkingLogs.map(log => (
                                        <tr key={log.id}>
                                            <td>{new Date(log.timestamp).toLocaleString()}</td>
                                            <td>{getParkingLogLabel(log.eventType)}</td>
                                            <td>{log.slotId}</td>
                                            <td>{log.stickerId || log.plateNumber || '-'}</td>
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
                <div className="panel">
                    <h3>Create Personnel Account</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <input type="text" placeholder="First Name" value={personnelFirstName} onChange={(e) => setPersonnelFirstName(e.target.value)} />
                        <input type="text" placeholder="Last Name" value={personnelLastName} onChange={(e) => setPersonnelLastName(e.target.value)} />
                        <input type="email" placeholder="Email" value={personnelEmail} onChange={(e) => setPersonnelEmail(e.target.value)} />
                        <input type="text" placeholder="Username" value={personnelUsername} onChange={(e) => setPersonnelUsername(e.target.value)} />
                        <PasswordField
                            value={personnelPassword}
                            onChange={(e) => setPersonnelPassword(e.target.value)}
                            placeholder="Password"
                            wrapperStyle={{ width: '100%' }}
                        />
                        <select value={personnelRole} onChange={(e) => setPersonnelRole(e.target.value)}>
                            <option value="admin">Admin</option>
                            <option value="guard">Security Guard</option>
                        </select>
                    </div>
                    <div style={{ marginTop: '12px' }}>
                        <button className="btn-green" onClick={handleCreatePersonnelAccount}>Create Account</button>
                    </div>
                </div>
                )}
                    </div>
                </div>
                </div>

            </div>
        </div>
    );
}