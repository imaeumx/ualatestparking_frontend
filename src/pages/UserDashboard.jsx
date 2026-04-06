import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { usePopup } from '../components/PopupContext';
import StickerManagement from '../components/StickerManagement';
import ParkingManagement from '../components/ParkingManagement';
import { encryptDES, decryptDES } from '../utils/desCrypto';

/**
 * ============================================================
 * UserDashboard Component
 * ============================================================
 * 
 * Main orchestrator page for logged-in users.
 * Combines sticker management and parking management into one interface.
 * 
 * ARCHITECTURE:
 * UserDashboard (this file) = State & API calls owner
 *     ├── StickerManagement = Sticker applications + payment + records table
 *     └── ParkingManagement = Parking slots visualization + reservations
 * 
 * Data Flow:
 * 1. On mount: fetch user profile, parking stickers (records), parking slots, user reservations
 * 2. Pass all data DOWN to child components as props (unidirectional data flow)
 * 3. Child components call parent's callback functions (e.g., fetchUserRecords) to trigger refreshes
 * 4. Example: User submits sticker app → StickerManagement calls fetchUserRecords → parent fetches updated list
 * 
 * State Organization:
 * - User profile data: user, oldPassword, newPassword, etc. (account settings)
 * - Sticker records: records (array of applications), plate, type (form inputs)
 * - Parking data: parkingSlots, userReservations (shared with ParkingManagement)
 * - UI state: showNotif, showSettings, activeTab, timeTick (visibility toggles and timing)
 * 
 * Key Functions:
 * - fetchUserInfo(): GET user profile from /api/user/<username>
 * - fetchUserRecords(): GET user's sticker applications from /api/sticker-records/
 * - fetchUserReservations(): GET user's parking reservations
 * - updatePassword(): PUT new password to backend
 * - decryptData(): Decrypt plate numbers from encrypted storage
 */
export default function UserDashboard() {
    const navigate = useNavigate();
    const { showError, showSuccess, showInfo } = usePopup();
    const passwordRule = /^(?=.*[A-Z])(?=.*\d).{8,}$/; // Regex: at least 1 uppercase, 1 digit, 8+ chars
    const TOTAL_PARKING_SLOTS = 180; // Total across all three parking areas (40 + 50 + 90)

    // ============ USER PROFILE STATE ============
    // Data fetched from /api/user/<username> on component mount
    const [user, setUser] = useState(null); // Current logged-in user (null until fetched)
    const [records, setRecords] = useState([]); // Array of user's sticker applications (decrypted for display)

    // ============ STICKER APPLICATION FORM STATE ============
    // Used by StickerManagement component
    const [plate, setPlate] = useState(''); // Plate input (managed here but mainly used in child)
    const [type, setType] = useState('4-Wheels'); // Vehicle type dropdown
    const [showNotif, setShowNotif] = useState(false); // Toggle notification panel visibility
    const [showSettings, setShowSettings] = useState(false); // Toggle settings/profile panel visibility
    const [showPaymentModal, setShowPaymentModal] = useState(false); // Toggle payment modal visibility
    const [timeTick, setTimeTick] = useState(Date.now()); // Current time (updated every 1 sec) - used for reservation expiration checks
    const [paymentMethod, setPaymentMethod] = useState('GCash'); // Selected payment method
    const [paymentReference, setPaymentReference] = useState(''); // Proof of payment reference

    // ============ PROFILE UPDATE STATE ============
    // Fields for password and identifier changes in settings panel
    const [oldPassword, setOldPassword] = useState(''); // User's current password (for verification)
    const [newPassword, setNewPassword] = useState(''); // New password (must match passwordRule)
    const [confirmNewPassword, setConfirmNewPassword] = useState(''); // Confirmation field (must match newPassword)
    const [newIdentifier, setNewIdentifier] = useState(''); // New student ID or identifier

    // ============ PARKING FUNCTIONALITY STATE ============
    // Shared with ParkingManagement component
    const [activeTab, setActiveTab] = useState('dashboard'); // Which tab is visible
    const [parkingSlots, setParkingSlots] = useState([]); // Array of all parking slots (180 total) with their status/occupant info
    const [stickers, setStickers] = useState([]); // [DEPRECATED: unused] - was for sticker list
    const [selectedParkingSlotId, setSelectedParkingSlotId] = useState(null); // Currently clicked slot ID
    const [selectedParkingAreaName, setSelectedParkingAreaName] = useState('Old Parking Space'); // Active parking lot
    const [showParkForSelectedSpot, setShowParkForSelectedSpot] = useState(false); // Toggle \"Park Vehicle\" form
    const [parkStickerInput, setParkStickerInput] = useState(''); // Parking form: sticker ID input
    const [parkPlateInput, setParkPlateInput] = useState(''); // Parking form: plate number input
    
    // Leave/check-out confirmation modal state
    const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState(false);
    const [leaveConfirmSlotId, setLeaveConfirmSlotId] = useState(null);
    
    const [userReservations, setUserReservations] = useState([]);
    const [applicationRecordsPage, setApplicationRecordsPage] = useState(1);
    const [userReservationsPage, setUserReservationsPage] = useState(1);
    const [reservationStatusNotifs, setReservationStatusNotifs] = useState([]);
    const [readReservationNotifKeys, setReadReservationNotifKeys] = useState([]);

    // Parking form state
    const [stickerInput, setStickerInput] = useState('');
    const [slotInput, setSlotInput] = useState('');
    const [leaveIdentifier, setLeaveIdentifier] = useState('');

    const paymentMethods = ['Pay On-Site', 'GCash', 'BPI', 'BDO', 'PNB', 'USSC', 'Palawan Express', 'RCBC', 'Cebuana Lhuillier'];

    // Dropdown data
    const strands = ["STEM", "ABM", "HUMSS", "GAS", "TVL"];
    const courses = ["BSIT", "BSCS", "BSBA", "BSCrim", "BSHM", "BSA", "BSED"];
    const nonStudentReasons = [
        'Parent/Guardian',
        'Service Personnel',
        'Visitor',
        'Delivery Rider',
        'Vendor/Supplier',
        'Alumni',
        'Event Participant',
        'Other'
    ];

    // Local alias used by existing UI code and child component props.
    const decryptData = (ciphertext) => decryptDES(ciphertext);

    const getCurrentSemesterRange = (baseDate = new Date()) => {
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth() + 1;

        if (month >= 8 && month <= 12) {
            return {
                start: new Date(year, 7, 1),
                end: new Date(year, 11, 31)
            };
        }

        if (month >= 1 && month <= 5) {
            return {
                start: new Date(year, 0, 1),
                end: new Date(year, 4, 31)
            };
        }

        return {
            start: new Date(year, 5, 1),
            end: new Date(year, 6, 31)
        };
    };

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

    /**
     * Get plate number from sticker ID by looking up user applications.
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

    /**
     * Get valid sticker IDs for the current semester.
     */
    const getValidUserStickers = () => {
        if (!records || records.length === 0) return [];
        return [...new Set(records
            .filter(r => isStickerValidForCurrentSemester(r))
            .map(r => (r.sticker_id || '').trim().toUpperCase())
            .filter(id => id))];
    };

    /**
     * Initialize user session and fetch application records.
     * Redirects to login if no valid session exists.
     */
    useEffect(() => {
        const savedUser = JSON.parse(localStorage.getItem('currentUser'));
        if (!savedUser) {
            navigate('/');
        } else {
            setUser(savedUser);
            setNewIdentifier(savedUser.identifier || '');
            fetchUserRecords(savedUser.username);
            fetchUserReservations(savedUser.username);
        }
    }, [navigate]);

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeTick(Date.now());
        }, 60 * 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!user?.username) return;
        fetchUserReservations(user.username);
    }, [timeTick, user?.username]);

    useEffect(() => {
        if (!user?.username) {
            setReservationStatusNotifs([]);
            setReadReservationNotifKeys([]);
            return;
        }

        const notifStorageKey = `reservationStatusNotifs_${user.username}`;
        const readStorageKey = `reservationStatusNotifRead_${user.username}`;

        const savedNotifs = JSON.parse(localStorage.getItem(notifStorageKey) || '[]');
        const savedReadKeys = JSON.parse(localStorage.getItem(readStorageKey) || '[]');

        setReservationStatusNotifs(Array.isArray(savedNotifs) ? savedNotifs : []);
        setReadReservationNotifKeys(Array.isArray(savedReadKeys) ? savedReadKeys : []);
    }, [user?.username]);

    useEffect(() => {
        if (!user?.username || !Array.isArray(userReservations)) return;

        const snapshotKey = `reservationStatusSnapshot_${user.username}`;
        const notifStorageKey = `reservationStatusNotifs_${user.username}`;

        const previousSnapshotRaw = JSON.parse(localStorage.getItem(snapshotKey) || '{}');
        const previousSnapshot = previousSnapshotRaw && typeof previousSnapshotRaw === 'object' ? previousSnapshotRaw : {};

        const storedNotifsRaw = JSON.parse(localStorage.getItem(notifStorageKey) || '[]');
        const storedNotifs = Array.isArray(storedNotifsRaw) ? storedNotifsRaw : [];
        const existingKeys = new Set(storedNotifs.map((item) => item.key));

        const nextSnapshot = {};
        const newNotifs = [];

        userReservations.forEach((reservation) => {
            const reservationId = String(reservation.id);
            const nextStatus = (reservation.status || '').toLowerCase();
            const previousStatus = (previousSnapshot[reservationId] || '').toLowerCase();
            nextSnapshot[reservationId] = nextStatus;

            if (!previousStatus || previousStatus === nextStatus) return;

            const notifKey = `${reservationId}-${nextStatus}`;
            if (existingKeys.has(notifKey)) return;

            newNotifs.push({
                key: notifKey,
                reservationId: reservation.id,
                previousStatus,
                nextStatus,
                reservedFor: reservation.reserved_for_datetime,
                adminNotes: (reservation.admin_notes || '').trim(),
                createdAt: new Date().toISOString()
            });
        });

        localStorage.setItem(snapshotKey, JSON.stringify(nextSnapshot));

        if (newNotifs.length > 0) {
            const mergedNotifs = [...newNotifs, ...storedNotifs].slice(0, 120);
            localStorage.setItem(notifStorageKey, JSON.stringify(mergedNotifs));
            setReservationStatusNotifs(mergedNotifs);

            const latest = newNotifs[0];
            showInfo(`Reservation #${latest.reservationId} changed to ${latest.nextStatus}.`, 2500);
            return;
        }

        setReservationStatusNotifs(storedNotifs);
    }, [user?.username, userReservations, showInfo]);

    useEffect(() => {
        setApplicationRecordsPage(1);
    }, [records.length]);

    useEffect(() => {
        setUserReservationsPage(1);
    }, [userReservations.length]);

    /**
     * Load parking slots and valid stickers from localStorage.
     */
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
        const savedStickers = localStorage.getItem('validParkingStickers');
        if (savedStickers) {
            setStickers(JSON.parse(savedStickers));
        } else {
            setStickers([]);
        }
    }, [TOTAL_PARKING_SLOTS]);

    /**
     * Fetch user's vehicle application records from backend.
     */
    const fetchUserRecords = async (username) => {
        try {
            const res = await axios.get(`http://127.0.0.1:8000/api/user-records/?username=${username}`);
            setRecords(res.data);
        } catch (err) {
            console.error("User fetch error:", err);
        }
    };

    /**
     * Fetch user's parking reservations (pending, approved, denied).
     */
    const fetchUserReservations = async (username) => {
        try {
            const res = await axios.get(`http://127.0.0.1:8000/api/user-reservations/?username=${username}`);
            setUserReservations(res.data);
        } catch (err) {
            console.error("Reservations fetch error:", err);
        }
    };

    /**
     * Park a vehicle in a specific slot after validating sticker ID.
     * Updates parking state and localStorage.
     */
    const parkVehicle = (slotId, plateNumber, stickerId) => {
        const normalizedStickerId = (stickerId || '').trim().toUpperCase();
        const currentStickers = getValidUserStickers();
        if (!currentStickers.includes(normalizedStickerId)) {
            showError(`Invalid sticker ID. Valid approved stickers: ${currentStickers.join(', ') || 'None available - please contact admin'}`);
            return false;
        }

        const targetSlot = parkingSlots.find(slot => slot.id === slotId);
        const reservationInfo = getReservationInfo(targetSlot);
        const reservedStickerId = (targetSlot?.reservedStickerId || '').trim().toUpperCase();
        if (reservationInfo && (reservationInfo.isActive || reservationInfo.isOverdue) && reservedStickerId && reservedStickerId !== normalizedStickerId) {
            showError('This spot is reserved right now. Please choose another spot.');
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
        showSuccess(`Vehicle ${plateNumber} parked in slot ${slotId}`);
        return true;
    };

    /**
     * Handle parking vehicle with proper form validation.
     */
    const handleParkVehicle = () => {
        if (!stickerInput.trim()) {
            showError('Please enter a sticker ID');
            return;
        }
        if (!slotInput.trim()) {
            showError('Please enter a slot number');
            return;
        }

        const sticker = stickerInput.trim().toUpperCase();
        const slot = parseInt(slotInput.trim());

        const plateNumber = getPlateFromSticker(sticker);
        if (!plateNumber) {
            showError('Invalid sticker ID or not valid for the current semester.');
            return;
        }

        const availableSlots = parkingSlots.filter(s => s.status === 'available');
        if (availableSlots.length === 0) {
            showError('No available slots');
            return;
        }

        if (availableSlots.find(s => s.id === slot)) {
            if (parkVehicle(slot, plateNumber, sticker)) {
                setStickerInput('');
                setSlotInput('');
            }
        } else {
            showError('Invalid slot number');
        }
    };

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

    const formatDateTime = (value) => {
        if (!value) return '---';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '---';
        return d.toLocaleString();
    };

    const getSlotStatusText = (slot) => {
        if (slot.status === 'occupied') return 'Occupied';
        const reservationInfo = getReservationInfo(slot);
        if (!reservationInfo) return 'Available';
        if (reservationInfo.isUpcoming) return 'Available';
        if (reservationInfo.isOverdue) return 'Reserved (Overdue)';
        if (reservationInfo.isActive) return 'Reserved (Now)';
        return 'Reserved';
    };

    const getSlotTooltipText = (slot) => {
        const lines = [
            `Spot ID: ${slot.id}`,
            `Status: ${getSlotStatusText(slot)}`,
            `Assigned Sticker ID: ${slot.stickerId || '---'}`
        ];

        if (slot.reservedStickerId || slot.reservedFor) {
            lines.push(`Reserved Sticker ID: ${slot.reservedStickerId || '---'}`);
            lines.push(`Reserved For: ${formatDateTime(slot.reservedFor)}`);
        }

        return lines.join('\n');
    };

    const isGuestReservationWindow = (slot) => {
        const reservationInfo = getReservationInfo(slot);
        const reservedSticker = (slot?.reservedStickerId || '').trim().toUpperCase();
        return !!reservationInfo && (reservationInfo.isActive || reservationInfo.isOverdue) && reservedSticker === 'N/A';
    };

    const handleParkSelectedSpot = () => {
        const selectedSlot = getSelectedParkingSlot();

        if (!selectedSlot) {
            showError('Please select a parking spot first.');
            return;
        }

        if (selectedSlot.status !== 'available') {
            showError('Selected spot is already occupied.');
            return;
        }

        const reservationInfo = getReservationInfo(selectedSlot);

        if (isGuestReservationWindow(selectedSlot)) {
            const guestPlateNumber = (parkPlateInput || '').trim().toUpperCase();
            if (!guestPlateNumber) {
                showError('Plate number is required for this multiple reservation parking.');
                return;
            }

            const updatedSlots = parkingSlots.map((slot) =>
                slot.id === selectedSlot.id
                    ? {
                        ...slot,
                        status: 'occupied',
                        plateNumber: guestPlateNumber,
                        stickerId: 'GUEST',
                        entryTime: new Date().toISOString(),
                        reservedFor: null,
                        reservedStickerId: ''
                    }
                    : slot
            );
            setParkingSlots(updatedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));
            setParkStickerInput('');
            setParkPlateInput('');
            setShowParkForSelectedSpot(false);
            showSuccess(`Vehicle ${guestPlateNumber} parked in slot ${selectedSlot.id}`);
            return;
        }

        if (!parkStickerInput.trim()) {
            showError('Please enter your UA sticker ID.');
            return;
        }

        const sticker = parkStickerInput.trim().toUpperCase();
        const reservedSticker = (selectedSlot.reservedStickerId || '').trim().toUpperCase();

        if (reservationInfo && (reservationInfo.isActive || reservationInfo.isOverdue) && reservedSticker && reservedSticker !== sticker) {
            showError('This slot has an active/overdue reservation. Guard can release expired reservations after checking no-show.');
            return;
        }

        const plateNumber = getPlateFromSticker(sticker);
        if (!plateNumber) {
            showError('Invalid sticker ID or not valid for the current semester.');
            return;
        }

        if (parkVehicle(selectedSlot.id, plateNumber, sticker)) {
            setParkStickerInput('');
            setShowParkForSelectedSpot(false);
        }
    };

    const handleGuardReleaseReservation = () => {
        const selectedSlot = getSelectedParkingSlot();
        if (!selectedSlot) return;

        const reservationInfo = getReservationInfo(selectedSlot);
        if (!reservationInfo || !reservationInfo.isOverdue) {
            showError('Only overdue reservations can be released.');
            return;
        }

        const updatedSlots = parkingSlots.map(slot =>
            slot.id === selectedSlot.id
                ? { ...slot, reservedStickerId: '', reservedFor: null }
                : slot
        );
        setParkingSlots(updatedSlots);
        localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));
        showInfo(`Reservation cleared for spot ${selectedSlot.id}.`);
    };

    /**
     * Remove vehicle from parking by slot number or plate number.
     */
    const leaveParking = (identifier) => {
        const trimmed = (identifier || '').trim();
        const normalized = trimmed.toUpperCase();

        let slot = null;
        if (/^\d+$/.test(trimmed)) {
            const slotId = parseInt(trimmed, 10);
            slot = parkingSlots.find(s => s.id === slotId && s.status === 'occupied');
        } else {
            slot = parkingSlots.find(
                s => (s.plateNumber || '').trim().toUpperCase() === normalized && s.status === 'occupied'
            );
        }

        if (!slot) {
            showError('Vehicle or slot not found, or slot is already available.');
            return;
        }

        const updatedSlots = parkingSlots.map(s =>
            s.id === slot.id ? { ...s, status: 'available', plateNumber: '', stickerId: '', entryTime: null } : s
        );
        setParkingSlots(updatedSlots);
        localStorage.setItem('parkingSlots', JSON.stringify(updatedSlots));
        showInfo(`Vehicle ${slot.plateNumber} left slot ${slot.id} successfully.`);
    };

    /**
     * Handle leaving parking with proper form validation.
     */
    const handleLeaveParking = () => {
        if (!leaveIdentifier.trim()) {
            showError('Please enter plate number or slot number');
            return;
        }
        leaveParking(leaveIdentifier.trim());
        setLeaveIdentifier('');
    };

    const isCurrentUserSpot = (slot) => {
        if (!slot || !slot.stickerId) return false;
        const normalizedSlotSticker = (slot.stickerId || '').trim().toUpperCase();
        if (!normalizedSlotSticker) return false;

        return records.some((record) => {
            const recordSticker = (record.sticker_id || '').trim().toUpperCase();
            return recordSticker && recordSticker === normalizedSlotSticker;
        });
    };

    const handleLeaveSelectedSpot = () => {
        const selectedSlot = getSelectedParkingSlot();
        if (!selectedSlot) {
            showError('Please select a parking spot first.');
            return;
        }

        if (selectedSlot.status !== 'occupied') {
            showError('Selected spot is not occupied.');
            return;
        }

        if (!isCurrentUserSpot(selectedSlot)) {
            showError('You can only leave/check out your own occupied spot.');
            return;
        }

        setLeaveConfirmSlotId(selectedSlot.id);
        setShowLeaveConfirmModal(true);
    };

    const handleConfirmLeaveSelectedSpot = () => {
        if (!leaveConfirmSlotId) {
            setShowLeaveConfirmModal(false);
            return;
        }

        leaveParking(String(leaveConfirmSlotId));
        setSelectedParkingSlotId(null);
        setLeaveConfirmSlotId(null);
        setShowLeaveConfirmModal(false);
    };

    const getParkingSlotFill = (slot) => {
        if (selectedParkingSlotId === slot.id) {
            return {
                background: 'linear-gradient(180deg, #0f766e 0%, #14b8a6 100%)',
                borderColor: '#0f766e',
                color: '#ffffff',
                shadow: '0 10px 24px rgba(20, 184, 166, 0.28)'
            };
        }

        if (slot.status === 'occupied') {
            return {
                background: 'linear-gradient(180deg, #fee2e2 0%, #fecaca 100%)',
                borderColor: '#ef4444',
                color: '#991b1b',
                shadow: '0 8px 18px rgba(239, 68, 68, 0.18)'
            };
        }

        const reservationInfo = getReservationInfo(slot);
        if (reservationInfo) {
            if (reservationInfo.isUpcoming) return {
                background: 'linear-gradient(180deg, #f3f4f6 0%, #e5e7eb 100%)',
                borderColor: '#9ca3af',
                color: '#374151',
                shadow: '0 8px 18px rgba(156, 163, 175, 0.18)'
            };

            return {
                background: reservationInfo.isOverdue
                    ? 'linear-gradient(180deg, #fef3c7 0%, #fde68a 100%)'
                    : 'linear-gradient(180deg, #fef9c3 0%, #fde68a 100%)',
                borderColor: reservationInfo.isOverdue ? '#d97706' : '#ca8a04',
                color: '#78350f',
                shadow: '0 8px 18px rgba(202, 138, 4, 0.18)'
            };
        }

        return {
            background: 'linear-gradient(180deg, #f3f4f6 0%, #e5e7eb 100%)',
            borderColor: '#9ca3af',
            color: '#374151',
            shadow: '0 8px 18px rgba(156, 163, 175, 0.18)'
        };
    };

    const getSelectedParkingSlot = () => parkingSlots.find(slot => slot.id === selectedParkingSlotId) || null;

    useEffect(() => {
        setShowParkForSelectedSpot(false);
        setParkStickerInput('');
        setParkPlateInput('');
    }, [selectedParkingSlotId, selectedParkingAreaName]);

    // Get unread notifications (application updates + reservation status updates)
    const applicationNotifications = records.filter(r => r.is_seen === false);
    const unreadReservationStatusNotifs = reservationStatusNotifs.filter(
        (notif) => !readReservationNotifKeys.includes(notif.key)
    );
    const unreadNotificationCount = applicationNotifications.length + unreadReservationStatusNotifs.length;

    useEffect(() => {
        if (!user?.username || parkingSlots.length === 0) return;

        const now = Date.now();
        const escalationDelayMs = 5 * 60 * 1000;
        const userNotifKey = `userReservationReminderNotifs_${user.username}`;
        const userNotifRaw = JSON.parse(localStorage.getItem(userNotifKey) || '[]');
        const userNotif = Array.isArray(userNotifRaw) ? userNotifRaw : [];

        const escalationNotifRaw = JSON.parse(localStorage.getItem('personnelEscalationNotifs') || '[]');
        const escalationNotif = Array.isArray(escalationNotifRaw) ? escalationNotifRaw : [];

        const approvedReservations = userReservations.filter(
            (reservation) => (reservation.status || '').toLowerCase() === 'approved'
        );

        let userChanged = false;
        let escalationChanged = false;

        approvedReservations.forEach((reservation) => {
            const reservedAt = new Date(reservation.reserved_for_datetime || '');
            if (Number.isNaN(reservedAt.getTime())) return;

            const graceEnd = new Date(reservedAt.getTime() + (30 * 60 * 1000));
            const overdueMs = now - graceEnd.getTime();
            if (overdueMs < 0) return;

            let spots = [];
            if (Array.isArray(reservation.reserved_spots)) {
                spots = reservation.reserved_spots;
            } else {
                try {
                    spots = JSON.parse(reservation.reserved_spots || '[]');
                } catch {
                    spots = [];
                }
            }

            spots
                .map((spot) => parseInt(spot, 10))
                .filter((spot) => !Number.isNaN(spot))
                .forEach((spotId) => {
                    const slot = parkingSlots.find((parkingSlot) => parkingSlot.id === spotId);
                    if (slot && slot.status === 'occupied') return;

                    const baseKey = `${reservation.id}-${spotId}`;
                    const userStageKey = `${baseKey}-user-30m`;
                    const escalationStageKey = `${baseKey}-personnel-35m`;

                    if (overdueMs < escalationDelayMs && !userNotif.includes(userStageKey)) {
                        userNotif.push(userStageKey);
                        userChanged = true;
                        showInfo(`Reservation for spot ${spotId} reached 30 minutes. If already parked, change it to Park now. If you will not show up, please release your reservation. Personnel escalation starts in 5 minutes.`, 2600);
                    }

                    if (overdueMs >= escalationDelayMs && !escalationNotif.includes(escalationStageKey)) {
                        escalationNotif.push(escalationStageKey);
                        escalationChanged = true;
                    }
                });
        });

        if (userChanged) {
            localStorage.setItem(userNotifKey, JSON.stringify(userNotif.slice(-400)));
        }
        if (escalationChanged) {
            localStorage.setItem('personnelEscalationNotifs', JSON.stringify(escalationNotif.slice(-500)));
        }
    }, [parkingSlots, userReservations, user, timeTick]);

    useEffect(() => {
        if (!Array.isArray(userReservations) || userReservations.length === 0 || parkingSlots.length === 0) {
            return;
        }

        const now = new Date();
        const approvedReservations = userReservations.filter((reservation) => {
            if ((reservation.status || '').toLowerCase() !== 'approved') return false;
            const reservedAt = new Date(reservation.reserved_for_datetime);
            return !Number.isNaN(reservedAt.getTime());
        });

        if (approvedReservations.length === 0) return;

        const updatesBySlot = new Map();

        const getReservationPriority = (reservedAtIso) => {
            const reservedAt = new Date(reservedAtIso);
            if (Number.isNaN(reservedAt.getTime())) {
                return { rank: -1, timeValue: 0 };
            }

            const graceEnd = new Date(reservedAt.getTime() + (30 * 60 * 1000));
            if (now > graceEnd) {
                return { rank: 3, timeValue: reservedAt.getTime() };
            }
            if (now >= reservedAt) {
                return { rank: 2, timeValue: reservedAt.getTime() };
            }
            // Upcoming gets the lowest priority; nearer upcoming time wins.
            return { rank: 1, timeValue: -reservedAt.getTime() };
        };

        approvedReservations.forEach((reservation) => {
            const reservedAtIso = reservation.reserved_for_datetime || null;
            const reservedSticker = (reservation.sticker_id || '').trim().toUpperCase();
            const nextPriority = getReservationPriority(reservedAtIso);

            let spots = [];
            if (Array.isArray(reservation.reserved_spots)) {
                spots = reservation.reserved_spots;
            } else {
                try {
                    spots = JSON.parse(reservation.reserved_spots || '[]');
                } catch {
                    spots = [];
                }
            }

            spots
                .map((spotId) => parseInt(spotId, 10))
                .filter((spotId) => !Number.isNaN(spotId))
                .forEach((spotId) => {
                    const current = updatesBySlot.get(spotId);
                    const shouldReplace = !current
                        || nextPriority.rank > current.priority.rank
                        || (nextPriority.rank === current.priority.rank && nextPriority.timeValue > current.priority.timeValue);

                    if (!shouldReplace) return;

                    updatesBySlot.set(spotId, {
                        reservedFor: reservedAtIso,
                        reservedStickerId: reservedSticker,
                        priority: nextPriority
                    });
                });
        });

        if (updatesBySlot.size === 0) return;

        let changed = false;
        const syncedSlots = parkingSlots.map((slot) => {
            const update = updatesBySlot.get(slot.id);
            if (!update) return slot;

            // Don't overwrite a currently occupied slot; reservation is already consumed.
            if (slot.status === 'occupied') return slot;

            const nextReservedFor = update.reservedFor || null;
            const nextReservedSticker = update.reservedStickerId || '';
            if (slot.reservedFor === nextReservedFor && slot.reservedStickerId === nextReservedSticker) {
                return slot;
            }

            changed = true;
            return {
                ...slot,
                reservedFor: nextReservedFor,
                reservedStickerId: nextReservedSticker
            };
        });

        if (changed) {
            setParkingSlots(syncedSlots);
            localStorage.setItem('parkingSlots', JSON.stringify(syncedSlots));
        }
    }, [userReservations, parkingSlots]);

    /**
     * Handle Enter key press for application form
     */
    const handleApplicationKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleProceedToPayment(e);
        }
    };

    /**
     * Mark all notifications as read for the current user.
     */
    const markAsRead = async () => {
        const unreadReservationKeys = unreadReservationStatusNotifs.map((notif) => notif.key);
        try {
            await axios.post('http://127.0.0.1:8000/api/mark-notifications-read/', {
                username: user.username
            });
            fetchUserRecords(user.username);
        } catch (err) {
            console.error("Could not mark as read:", err);
        }

        if (user?.username && unreadReservationKeys.length > 0) {
            const readStorageKey = `reservationStatusNotifRead_${user.username}`;
            const mergedReadKeys = [...new Set([...readReservationNotifKeys, ...unreadReservationKeys])];
            setReadReservationNotifKeys(mergedReadKeys);
            localStorage.setItem(readStorageKey, JSON.stringify(mergedReadKeys));
        }

        setShowNotif(false);
    };

    // 3. Update Profile Logic
    const handleUpdateProfile = async () => {
        try {
            const wantsPasswordChange = oldPassword || newPassword || confirmNewPassword;

            if (wantsPasswordChange) {
                if (!oldPassword || !newPassword || !confirmNewPassword) {
                    showError('Please fill old password, new password, and confirm new password.');
                    return;
                }

                if (!passwordRule.test(oldPassword)) {
                    showError('Old password must be at least 8 characters with at least one uppercase letter and one number.');
                    return;
                }

                if (!passwordRule.test(newPassword)) {
                    showError('New password must be at least 8 characters with at least one uppercase letter and one number.');
                    return;
                }

                if (!passwordRule.test(confirmNewPassword)) {
                    showError('Confirm password must be at least 8 characters with at least one uppercase letter and one number.');
                    return;
                }

                if (newPassword !== confirmNewPassword) {
                    showError('New password and confirm new password do not match.');
                    return;
                }
            }

            const updateData = {
                username: user.username,
                identifier: newIdentifier,
            };
            
            if (wantsPasswordChange) {
                updateData.oldPassword = oldPassword.trim();
                updateData.password = newPassword.trim();
            }

            await axios.post('http://127.0.0.1:8000/api/update-profile/', updateData);
            
            if (wantsPasswordChange) {
                showSuccess("Password changed! Please log in again.");
                localStorage.removeItem('currentUser');
                navigate('/');
            } else {
                const updatedUser = { ...user, identifier: newIdentifier };
                localStorage.setItem('currentUser', JSON.stringify(updatedUser));
                setUser(updatedUser);
                showSuccess("Profile updated successfully!");
                setShowSettings(false);
            }
        } catch (err) {
            showError(err?.response?.data?.message || "Update failed. Check backend connection.");
        }
    };

    // 4. Submit Application
    const submitApp = async () => {
        if (!plate) return showError("Please enter Plate Number.");
        if (!paymentMethod) return showError("Please select payment method.");
        if (!paymentReference.trim()) return showError("Please enter payment reference number.");

        const displayFullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;
        const encPlate = encryptDES(plate);
        const encOwner = encryptDES(displayFullName);
        
        try {
            await axios.post('http://127.0.0.1:8000/api/submit-vehicle/', {
                username: user.username,
                ownerName: encOwner,
                plateNumber: encPlate,
                vehicleType: type,
                paymentMethod,
                paymentReference: paymentReference.trim()
            });
            showSuccess("Application Sent!");
            setPlate('');
            setPaymentMethod('GCash');
            setPaymentReference('');
            setShowPaymentModal(false);
            fetchUserRecords(user.username);
        } catch (err) {
            showError(err?.response?.data?.message || "Submission failed.");
        }
    };

    const handleProceedToPayment = (e) => {
        e.preventDefault();
        if (!plate.trim()) {
            showError('Please enter Plate Number before proceeding to payment.');
            return;
        }
        setShowPaymentModal(true);
    };

    if (!user) return null;

    const normalizedRole = (user.role || '').toLowerCase();
    const isAdmin = normalizedRole === 'admin';
    const isGuest = normalizedRole === 'guest' || normalizedRole === 'non-student';
    const roleLabel = isGuest ? 'NON-STUDENT' : (user.role?.toUpperCase() || 'USER');
    const validStickerList = getValidUserStickers();
    const occupiedCount = parkingSlots.filter(slot => slot.status === 'occupied').length;
    const pendingReservationsCount = userReservations.filter(res => res.status === 'pending').length;
    const displayParkingSlots = Array.from({ length: TOTAL_PARKING_SLOTS }, (_, i) => {
        return parkingSlots.find(slot => slot.id === i + 1) || {
            id: i + 1,
            status: 'available',
            plateNumber: '',
            stickerId: '',
            entryTime: null,
            reservedFor: null,
            reservedStickerId: ''
        };
    });
    const parkingAreas = [
        { name: 'Old Parking Space', startId: 1, slotCount: 40, slotsPerRow: 10, totalRows: 4 },
        { name: 'Vertical Parking Space', startId: 41, slotCount: 50, slotsPerRow: 10, totalRows: 5 },
        { name: 'New Parking Space', startId: 91, slotCount: 90, slotsPerRow: 15, totalRows: 6 }
    ];
    const selectedParkingArea = parkingAreas.find(area => area.name === selectedParkingAreaName) || parkingAreas[0];
    const visibleParkingAreas = [selectedParkingArea];
    const selectedParkingSlot = getSelectedParkingSlot();
    const displayFullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;

    const USER_RECORDS_PAGE_SIZE = 10;
    const USER_RESERVATIONS_PAGE_SIZE = 10;

    const orderedUserApplicationRecords = records.slice().reverse();
    const userApplicationTotalPages = Math.max(1, Math.ceil(orderedUserApplicationRecords.length / USER_RECORDS_PAGE_SIZE));
    const safeApplicationRecordsPage = Math.min(applicationRecordsPage, userApplicationTotalPages);
    const paginatedUserApplicationRecords = orderedUserApplicationRecords.slice(
        (safeApplicationRecordsPage - 1) * USER_RECORDS_PAGE_SIZE,
        (safeApplicationRecordsPage - 1) * USER_RECORDS_PAGE_SIZE + USER_RECORDS_PAGE_SIZE
    );

    const userReservationsTotalPages = Math.max(1, Math.ceil(userReservations.length / USER_RESERVATIONS_PAGE_SIZE));
    const safeUserReservationsPage = Math.min(userReservationsPage, userReservationsTotalPages);
    const paginatedUserReservations = userReservations.slice(
        (safeUserReservationsPage - 1) * USER_RESERVATIONS_PAGE_SIZE,
        (safeUserReservationsPage - 1) * USER_RESERVATIONS_PAGE_SIZE + USER_RESERVATIONS_PAGE_SIZE
    );

    return (
        <div className="center">
            <div className="card dashboard-card">
                <div className="topbar">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <h2 style={{ margin: 0 }}>Welcome, <span style={{ color: '#6366f1' }}>{displayFullName}</span></h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <p className="subtitle" style={{ margin: 0 }}>UA Parking Portal •</p>
                            <span className={`role-badge ${isGuest ? 'guest-tag' : 'student-tag'}`}>
                                {roleLabel}
                            </span>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', position: 'relative' }}>
                        <button className="btn-gray slim" onClick={() => setShowSettings(true)}>⚙️</button>

                        <button className="btn-gray slim bell-btn" onClick={() => setShowNotif(!showNotif)}>
                            🔔
                            {unreadNotificationCount > 0 && <span className="notif-count">{unreadNotificationCount}</span>}
                        </button>

                        {showNotif && (
                            <div className="notif-dropdown">
                                <h4>Recent Updates</h4>
                                {unreadNotificationCount === 0 ? (
                                    <p className="empty-notif">No new notifications.</p>
                                ) : (
                                    <>
                                        {applicationNotifications.slice().reverse().map((n, i) => (
                                            <div key={`app-${i}`} className="notif-item">
                                                Vehicle <strong>{decryptData(n.plate_number)}</strong> has been
                                                <strong className={n.status === 'Approved' ? 'text-green' : 'text-red'}> {n.status}</strong>.
                                            </div>
                                        ))}
                                        {unreadReservationStatusNotifs.map((notif) => (
                                            <div key={notif.key} className="notif-item">
                                                Reservation <strong>#{notif.reservationId}</strong> changed from
                                                <strong style={{ color: '#b45309' }}> {notif.previousStatus || 'pending'}</strong> to
                                                <strong style={{ color: notif.nextStatus === 'approved' ? '#16a34a' : notif.nextStatus === 'denied' ? '#dc2626' : '#0f766e' }}> {notif.nextStatus}</strong>.
                                                {notif.adminNotes ? (
                                                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#475569' }}>
                                                        Note: {notif.adminNotes}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </>
                                )}
                                {unreadNotificationCount > 0 && (
                                    <button className="link-btn mark-read" onClick={markAsRead}>Mark as Read</button>
                                )}
                            </div>
                        )}

                        <button className="btn-blue slim" onClick={() => { localStorage.removeItem('currentUser'); navigate('/'); }}>
                            Logout
                        </button>
                    </div>
                </div>

                {/* SETTINGS MODAL POPUP */}
                {showSettings && (
                    <div className="modal-overlay">
                        <div className="modal-content card" style={{ maxWidth: '520px', width: '92%' }}>
                            <h3 style={{ marginTop: 0, color: '#ffffff' }}>Account Settings</h3>
                            <div style={{ textAlign: 'left', marginTop: '15px' }}>
                                <label className="small-label">Old Password</label>
                                <input 
                                    type="password" 
                                    placeholder="Enter old password" 
                                    value={oldPassword} 
                                    onChange={(e) => setOldPassword(e.target.value)} 
                                    style={{ marginBottom: '10px' }}
                                />

                                <label className="small-label">New Password</label>
                                <input 
                                    type="password" 
                                    placeholder="Enter new password" 
                                    value={newPassword} 
                                    onChange={(e) => setNewPassword(e.target.value)} 
                                    style={{ marginBottom: '10px' }}
                                />

                                <label className="small-label">Confirm New Password</label>
                                <input 
                                    type="password" 
                                    placeholder="Confirm new password" 
                                    value={confirmNewPassword} 
                                    onChange={(e) => setConfirmNewPassword(e.target.value)} 
                                    style={{ marginBottom: '15px' }}
                                />

                                <hr style={{ border: '0.5px solid #e2e8f0', margin: '15px 0' }} />

                                {isGuest ? (
                                    <div>
                                        <label className="small-label">Reason for Account</label>
                                        <select value={newIdentifier} onChange={(e) => setNewIdentifier(e.target.value)}>
                                            <option value="">Select Reason</option>
                                            {!nonStudentReasons.includes(newIdentifier) && newIdentifier && (
                                                <option value={newIdentifier}>Current: {newIdentifier}</option>
                                            )}
                                            {nonStudentReasons.map(reason => (
                                                <option key={reason} value={reason}>{reason}</option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <div>
                                            <label className="small-label">Student ID (Permanent)</label>
                                            <input type="text" value={user.identifier.split(' | ')[0]} disabled className="disabled-input" />
                                        </div>
                                        <div>
                                            <label className="small-label">Update Level</label>
                                            <select 
                                                value={newIdentifier.includes('Senior High') ? 'Senior High' : 'College'} 
                                                onChange={(e) => {
                                                    const idPart = user.identifier.split(' | ')[0];
                                                    setNewIdentifier(`${idPart} | ${e.target.value} - `);
                                                }}
                                            >
                                                <option value="Senior High">Senior High</option>
                                                <option value="College">College</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="small-label">Select Course/Strand</label>
                                            <select 
                                                onChange={(e) => {
                                                    const base = newIdentifier.split(' - ')[0];
                                                    setNewIdentifier(`${base} - ${e.target.value}`);
                                                }}
                                            >
                                                <option value="">-- Choose --</option>
                                                {(newIdentifier.includes('Senior High') ? strands : courses).map(item => (
                                                    <option key={item} value={item}>{item}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                                <button className="btn-green" style={{ flex: 1, whiteSpace: 'nowrap' }} onClick={handleUpdateProfile}>Save Changes</button>
                                <button className="btn-gray" onClick={() => { setShowSettings(false); setOldPassword(''); setNewPassword(''); setConfirmNewPassword(''); }}>Cancel</button>
                            </div>
                        </div>
                    </div>
                )}

                {showPaymentModal && (
                    <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
                        <div className="modal-content card" style={{ maxWidth: '560px', width: '94%', color: '#ffffff' }} onClick={(e) => e.stopPropagation()}>
                            <h3 style={{ marginTop: 0, color: '#ffffff' }}>Sticker Payment</h3>
                            <p style={{ marginBottom: '12px', color: '#ffffff' }}>
                                List of Payment Method:{' '}
                                <a
                                    href="https://bit.ly/ListOfPaymentMethod"
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: '#93c5fd' }}
                                >
                                    https://bit.ly/ListOfPaymentMethod
                                </a>
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div>
                                        <label className="small-label" style={{ color: '#ffffff' }}>Payment Method</label>
                                        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                                            {paymentMethods.map(method => (
                                                <option key={method} value={method}>{method}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="small-label" style={{ color: '#ffffff' }}>Reference Number</label>
                                        <input
                                            type="text"
                                            placeholder="Enter payment reference number"
                                            value={paymentReference}
                                            onChange={(e) => setPaymentReference(e.target.value)}
                                        />
                                    </div>
                                    <div style={{ padding: '10px', borderRadius: '8px', background: '#1e3a8a', color: '#ffffff', fontSize: '13px' }}>
                                        Fee: {type === '2-Wheels' ? 'Php 1,000' : type === '4-Wheels' ? 'Php 2,000' : 'Php 3,000'}
                                    </div>
                            </div>

                            <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
                                <button className="btn-gray" style={{ width: '110px', flexShrink: 0 }} onClick={() => setShowPaymentModal(false)}>Back</button>
                                <button className="btn-green" style={{ flex: 1 }} onClick={submitApp}>Confirm Payment</button>
                            </div>
                        </div>
                    </div>
                )}

                    <ParkingManagement
                    user={user}
                    parkingSlots={parkingSlots}
                    setParkingSlots={setParkingSlots}
                    userReservations={userReservations}
                    records={records}
                    TOTAL_PARKING_SLOTS={TOTAL_PARKING_SLOTS}
                    getValidUserStickers={getValidUserStickers}
                    getPlateFromSticker={getPlateFromSticker}
                    getReservationInfo={getReservationInfo}
                    formatDateTime={formatDateTime}
                    getSlotStatusText={getSlotStatusText}
                    getSlotTooltipText={getSlotTooltipText}
                    fetchUserReservations={fetchUserReservations}
                />

                    </div>

                    <div style={{ flex: '1 1 680px', minWidth: 0 }}>

                {activeTab === 'stickers' && (
                <>
                <StickerManagement
                    user={user}
                    records={records}
                    paymentMethods={paymentMethods}
                    displayFullName={displayFullName}
                    decryptData={decryptData}
                    fetchUserRecords={fetchUserRecords}
                />
                </>)}

                {activeTab === 'dashboard' && (
                <>

                <div className="panel">
                    <h3 className="panel-title">Dashboard</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '12px' }}>
                            <div style={{ color: '#4c1d95', fontSize: '12px', fontWeight: 700 }}>My Applications</div>
                            <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#1e1b4b' }}>{records.length}</div>
                        </div>
                        <div style={{ background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: '10px', padding: '12px' }}>
                            <div style={{ color: '#0f766e', fontSize: '12px', fontWeight: 700 }}>Valid Stickers</div>
                            <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#134e4a' }}>{validStickerList.length}</div>
                        </div>
                        <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px' }}>
                            <div style={{ color: '#92400e', fontSize: '12px', fontWeight: 700 }}>Pending Reservations</div>
                            <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#78350f' }}>{pendingReservationsCount}</div>
                        </div>
                        <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '10px', padding: '12px' }}>
                            <div style={{ color: '#166534', fontSize: '12px', fontWeight: 700 }}>Occupied Slots</div>
                            <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#14532d' }}>{occupiedCount} / {TOTAL_PARKING_SLOTS}</div>
                        </div>
                    </div>
                </div>

                <div className="panel">
                    <h3 className="panel-title">📋 My Parking Reservations</h3>
                    {userReservations.length === 0 ? (
                        <p style={{ color: '#64748b' }}>You haven't made any reservations yet.</p>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Spots</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Reason</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Reserved For</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Submitted</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Admin Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedUserReservations.map((res) => {
                                        const statusColor = 
                                            res.status === 'approved' ? '#10b981' :
                                            res.status === 'denied' ? '#ef4444' :
                                            res.status === 'pending' ? '#f59e0b' :
                                            '#6b7280';
                                        const statusBg = 
                                            res.status === 'approved' ? '#d1fae5' :
                                            res.status === 'denied' ? '#fee2e2' :
                                            res.status === 'pending' ? '#fef3c7' :
                                            '#f3f4f6';

                                        return (
                                            <tr key={res.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                                <td style={{ padding: '10px', fontWeight: 600 }}>
                                                    {Array.isArray(res.reserved_spots) 
                                                        ? res.reserved_spots.join(', ')
                                                        : JSON.parse(res.reserved_spots || '[]').join(', ')}
                                                </td>
                                                <td style={{ padding: '10px', fontSize: '12px' }}>{res.reservation_reason}</td>
                                                <td style={{ padding: '10px', fontSize: '12px' }}>
                                                    {new Date(res.reserved_for_datetime).toLocaleString()}
                                                </td>
                                                <td style={{ padding: '10px' }}>
                                                    <span style={{
                                                        display: 'inline-block',
                                                        padding: '4px 8px',
                                                        background: statusBg,
                                                        color: statusColor,
                                                        borderRadius: '4px',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        textTransform: 'uppercase'
                                                    }}>
                                                        {res.status}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '10px', fontSize: '12px' }}>
                                                    {new Date(res.created_at).toLocaleString()}
                                                </td>
                                                <td style={{ padding: '10px', fontSize: '12px', color: '#64748b' }}>
                                                    {res.admin_notes || '---'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {userReservations.length > USER_RESERVATIONS_PAGE_SIZE && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                            <button
                                className="btn-gray slim"
                                onClick={() => setUserReservationsPage((prev) => Math.max(1, prev - 1))}
                                disabled={safeUserReservationsPage === 1}
                                style={{ marginTop: 0, opacity: safeUserReservationsPage === 1 ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                            >
                                Prev
                            </button>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#334155', minWidth: '90px', textAlign: 'center' }}>
                                Page {safeUserReservationsPage} of {userReservationsTotalPages}
                            </span>
                            <button
                                className="btn-gray slim"
                                onClick={() => setUserReservationsPage((prev) => Math.min(userReservationsTotalPages, prev + 1))}
                                disabled={safeUserReservationsPage === userReservationsTotalPages}
                                style={{ marginTop: 0, opacity: safeUserReservationsPage === userReservationsTotalPages ? 0.6 : 1, fontSize: '12px', padding: '4px 8px' }}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>

                </>)}

                {activeTab === 'sticker-verification' && (
                <>

                <div className="panel">
                    <h3 className="panel-title">Sticker Verification</h3>
                    {validStickerList.length === 0 ? (
                        <p style={{ color: '#64748b' }}>No active sticker found for this account.</p>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9' }}>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Sticker ID</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Plate Number</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Expires</th>
                                        <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {records
                                        .filter(r => r.status === 'Approved' && r.sticker_id)
                                        .slice()
                                        .reverse()
                                        .map((record, index) => {
                                            const isSemesterValid = isStickerValidForCurrentSemester(record);
                                            return (
                                                <tr key={`${record.sticker_id}-${index}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                                                    <td style={{ padding: '10px', fontWeight: 700 }}>{record.sticker_id}</td>
                                                    <td style={{ padding: '10px' }}>{decryptData(record.plate_number)}</td>
                                                    <td style={{ padding: '10px' }}>{record.expiration_date ? new Date(record.expiration_date).toLocaleDateString() : '---'}</td>
                                                    <td style={{ padding: '10px' }}>
                                                        <span style={{
                                                            display: 'inline-block',
                                                            padding: '4px 8px',
                                                            borderRadius: '999px',
                                                            background: isSemesterValid ? '#dcfce7' : '#fee2e2',
                                                            color: isSemesterValid ? '#166534' : '#b91c1c',
                                                            fontSize: '11px',
                                                            fontWeight: 700
                                                        }}>
                                                            {isSemesterValid ? 'Verified' : 'Invalid This Semester'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                </>)}

                {activeTab === 'reports' && isAdmin && (
                <>

                <div className="panel">
                    <h3 className="panel-title">Reports</h3>
                    <p style={{ marginTop: 0, color: '#64748b' }}>Admin snapshot of your current parking and reservation activity.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#ffffff' }}>
                            <div style={{ color: '#334155', fontSize: '12px', fontWeight: 700 }}>Total Reservations</div>
                            <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>{userReservations.length}</div>
                        </div>
                        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#ffffff' }}>
                            <div style={{ color: '#334155', fontSize: '12px', fontWeight: 700 }}>Approved Applications</div>
                            <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>{records.filter(r => r.status === 'Approved').length}</div>
                        </div>
                        <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#ffffff' }}>
                            <div style={{ color: '#334155', fontSize: '12px', fontWeight: 700 }}>Occupied Slots</div>
                            <div style={{ marginTop: '6px', fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>{occupiedCount}</div>
                        </div>
                    </div>
                </div>

                </>)}

                {showLeaveConfirmModal && (
                    <div style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(15, 23, 42, 0.55)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000,
                        padding: '16px'
                    }}>
                        <div style={{
                            width: '100%',
                            maxWidth: '420px',
                            background: '#ffffff',
                            borderRadius: '14px',
                            boxShadow: '0 18px 42px rgba(15, 23, 42, 0.22)',
                            border: '1px solid #e2e8f0',
                            padding: '18px'
                        }}>
                            <h3 style={{ margin: '0 0 8px', color: '#0f172a', fontSize: '1rem' }}>Confirm Check Out</h3>
                            <p style={{ margin: '0 0 14px', color: '#475569', fontSize: '13px' }}>
                                Leave/check out spot #{leaveConfirmSlotId} now?
                            </p>

                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    type="button"
                                    className="btn-green"
                                    onClick={handleConfirmLeaveSelectedSpot}
                                    style={{ flex: 1, marginTop: 0 }}
                                >
                                    Yes, Check Out
                                </button>
                                <button
                                    type="button"
                                    className="btn-gray"
                                    onClick={() => {
                                        setShowLeaveConfirmModal(false);
                                        setLeaveConfirmSlotId(null);
                                    }}
                                    style={{ flex: 1, marginTop: 0 }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}