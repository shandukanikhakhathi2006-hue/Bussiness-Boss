// script.js

document.addEventListener('DOMContentLoaded', function() {
    // Sample data for dashboard summary cards
    const summaryData = {
        totalCustomers: 120,
        totalBookings: 75,
        totalInvoices: 50,
        totalRevenue: 15000
    };

    // Sample data for recent bookings and invoices
    const recentBookings = [
        { id: 1, customer: 'John Doe', date: '2023-10-01', service: 'Consultation', amount: 200 },
        { id: 2, customer: 'Jane Smith', date: '2023-10-02', service: 'Follow-up', amount: 150 },
        { id: 3, customer: 'Alice Johnson', date: '2023-10-03', service: 'New Client', amount: 300 }
    ];

    const recentInvoices = [
        { id: 1, customer: 'John Doe', date: '2023-10-01', amount: 200, status: 'Paid' },
        { id: 2, customer: 'Jane Smith', date: '2023-10-02', amount: 150, status: 'Pending' },
        { id: 3, customer: 'Alice Johnson', date: '2023-10-03', amount: 300, status: 'Paid' }
    ];

    // Function to populate summary cards
    function populateSummaryCards() {
        document.getElementById('total-customers').innerText = summaryData.totalCustomers;
        document.getElementById('total-bookings').innerText = summaryData.totalBookings;
        document.getElementById('total-invoices').innerText = summaryData.totalInvoices;
        document.getElementById('total-revenue').innerText = `$${summaryData.totalRevenue}`;
    }

    // Function to populate recent bookings table
    function populateRecentBookings() {
        const bookingsTableBody = document.getElementById('recent-bookings-body');
        recentBookings.forEach(booking => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${booking.id}</td>
                <td>${booking.customer}</td>
                <td>${booking.date}</td>
                <td>${booking.service}</td>
                <td>$${booking.amount}</td>
            `;
            bookingsTableBody.appendChild(row);
        });
    }

    // Function to populate recent invoices table
    function populateRecentInvoices() {
        const invoicesTableBody = document.getElementById('recent-invoices-body');
        recentInvoices.forEach(invoice => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${invoice.id}</td>
                <td>${invoice.customer}</td>
                <td>${invoice.date}</td>
                <td>$${invoice.amount}</td>
                <td>${invoice.status}</td>
            `;
            invoicesTableBody.appendChild(row);
        });
    }

    // Function to handle sidebar toggle on mobile
    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('active');
    }

    // Event listeners for quick action buttons
    document.getElementById('add-customer-btn').addEventListener('click', function() {
        alert('Add Customer functionality to be implemented.');
    });

    document.getElementById('add-booking-btn').addEventListener('click', function() {
        alert('Add Booking functionality to be implemented.');
    });

    document.getElementById('add-invoice-btn').addEventListener('click', function() {
        alert('Add Invoice functionality to be implemented.');
    });

    document.getElementById('add-expense-btn').addEventListener('click', function() {
        alert('Add Expense functionality to be implemented.');
    });

    // Initial population of data
    populateSummaryCards();
    populateRecentBookings();
    populateRecentInvoices();
});