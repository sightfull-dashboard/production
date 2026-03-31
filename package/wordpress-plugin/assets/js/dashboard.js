jQuery(document).ready(function($) {
    const app = {
        state: {
            section: 'analytics',
            employees: []
        },

        init() {
            this.bindEvents();
            this.loadSection('analytics');
            this.fetchData();
        },

        bindEvents() {
            $('.vdp-nav-item').on('click', (e) => {
                const section = $(e.currentTarget).data('section');
                this.loadSection(section);
            });

            $('#vdp-add-btn').on('click', () => {
                this.openModal('Add New');
            });

            $('.vdp-modal-close').on('click', () => {
                $('#vdp-modal').fadeOut(200);
            });
        },

        fetchData() {
            $.post(vdpData.ajax_url, {
                action: 'vdp_get_data',
                nonce: vdpData.nonce
            }, (res) => {
                if (res.success) {
                    this.state.employees = res.data.employees;
                    if (this.state.section === 'employees') this.renderEmployees();
                }
            });
        },

        loadSection(section) {
            this.state.section = section;
            $('.vdp-nav-item').removeClass('active');
            $(`.vdp-nav-item[data-section="${section}"]`).addClass('active');
            $('#vdp-section-title').text(section.charAt(0).toUpperCase() + section.slice(1));

            const $content = $('#vdp-content-area');
            $content.html('<div class="vdp-loading">Loading...</div>');

            setTimeout(() => {
                if (section === 'analytics') this.renderAnalytics();
                if (section === 'employees') this.renderEmployees();
                if (section === 'shifts') this.renderShifts();
                if (section === 'roster') this.renderRoster();
            }, 300);
        },

        renderAnalytics() {
            $('#vdp-content-area').html(`
                <div class="vdp-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;">
                    <div class="vdp-card" style="background: #6366f1; color: white;">
                        <div style="font-size: 12px; font-weight: 700; opacity: 0.8;">TOTAL WORKFORCE</div>
                        <div style="font-size: 32px; font-weight: 900; margin-top: 8px;">124</div>
                    </div>
                    <div class="vdp-card" style="background: #10b981; color: white;">
                        <div style="font-size: 12px; font-weight: 700; opacity: 0.8;">HOURS THIS WEEK</div>
                        <div style="font-size: 32px; font-weight: 900; margin-top: 8px;">1,240</div>
                    </div>
                    <div class="vdp-card" style="background: #f59e0b; color: white;">
                        <div style="font-size: 12px; font-weight: 700; opacity: 0.8;">PENDING ACTIONS</div>
                        <div style="font-size: 32px; font-weight: 900; margin-top: 8px;">4</div>
                    </div>
                </div>
            `);
        },

        renderEmployees() {
            let rows = this.state.employees.map(emp => `
                <tr>
                    <td><strong>${emp.name}</strong></td>
                    <td><span class="vdp-badge">${emp.dept}</span></td>
                    <td>R ${emp.rate}</td>
                    <td><button class="vdp-btn vdp-btn-ghost">Edit</button></td>
                </tr>
            `).join('');

            $('#vdp-content-area').html(`
                <div class="vdp-card">
                    <table class="vdp-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Department</th>
                                <th>Rate</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `);
        },

        openModal(title) {
            $('#vdp-modal-title').text(title);
            $('#vdp-modal').css('display', 'flex').hide().fadeIn(200);
        }
    };

    app.init();
});
