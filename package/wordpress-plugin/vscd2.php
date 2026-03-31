<?php
/**
 * Plugin Name: Veridian Dashboard Pro
 * Description: A premium workforce management dashboard for WordPress.
 * Version: 2.0.0
 * Author: Veridian Studios
 */

if ( ! defined( 'ABSPATH' ) ) exit;

class Veridian_Dashboard_Pro {
    public function __construct() {
        add_shortcode( 'veridian_dashboard', [ $this, 'render_dashboard' ] );
        add_action( 'wp_enqueue_scripts', [ $this, 'enqueue_assets' ] );
        
        // AJAX Handlers
        add_action( 'wp_ajax_vdp_get_data', [ $this, 'ajax_get_data' ] );
        add_action( 'wp_ajax_vdp_save_employee', [ $this, 'ajax_save_employee' ] );
    }

    public function enqueue_assets() {
        global $post;
        if ( has_shortcode( $post->post_content, 'veridian_dashboard' ) ) {
            wp_enqueue_style( 'vdp-google-fonts', 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap' );
            wp_enqueue_style( 'vdp-styles', plugins_url( 'assets/css/dashboard.css', __FILE__ ), [], '2.0.0' );
            wp_enqueue_script( 'vdp-script', plugins_url( 'assets/js/dashboard.js', __FILE__ ), ['jquery'], '2.0.0', true );
            
            wp_localize_script( 'vdp-script', 'vdpData', [
                'ajax_url' => admin_url( 'admin-ajax.php' ),
                'nonce'    => wp_create_nonce( 'vdp_nonce' ),
                'page_id'  => get_the_ID()
            ]);
        }
    }

    public function render_dashboard() {
        ob_start();
        ?>
        <div id="vdp-app" class="vdp-wrap">
            <!-- Sidebar -->
            <aside class="vdp-sidebar">
                <div class="vdp-brand">
                    <div class="vdp-logo-icon">V</div>
                    <span class="vdp-brand-name">VERIDIAN</span>
                </div>
                <nav class="vdp-nav">
                    <button class="vdp-nav-item active" data-section="analytics">
                        <span class="vdp-icon">📊</span> Analytics
                    </button>
                    <button class="vdp-nav-item" data-section="employees">
                        <span class="vdp-icon">👥</span> Employees
                    </button>
                    <button class="vdp-nav-item" data-section="shifts">
                        <span class="vdp-icon">⏰</span> Shifts
                    </button>
                    <button class="vdp-nav-item" data-section="roster">
                        <span class="vdp-icon">📅</span> Roster
                    </button>
                </nav>
                <div class="vdp-sidebar-footer">
                    <div class="vdp-user-pill">
                        <div class="vdp-avatar">AD</div>
                        <div class="vdp-user-info">
                            <span class="vdp-user-name">Admin</span>
                            <span class="vdp-user-role">Manager</span>
                        </div>
                    </div>
                </div>
            </aside>

            <!-- Main Content -->
            <main class="vdp-main">
                <header class="vdp-header">
                    <h2 id="vdp-section-title">Analytics</h2>
                    <div class="vdp-header-actions">
                        <div class="vdp-search-wrap">
                            <input type="text" id="vdp-search" placeholder="Search...">
                        </div>
                        <button class="vdp-btn vdp-btn-primary" id="vdp-add-btn">
                            + Add New
                        </button>
                    </div>
                </header>

                <div id="vdp-content-area">
                    <!-- Dynamic Content Loaded via JS -->
                </div>
            </main>

            <!-- Modal -->
            <div id="vdp-modal" class="vdp-modal-backdrop">
                <div class="vdp-modal">
                    <div class="vdp-modal-header">
                        <h3 id="vdp-modal-title">Edit Details</h3>
                        <button class="vdp-modal-close">&times;</button>
                    </div>
                    <div class="vdp-modal-body">
                        <form id="vdp-form">
                            <!-- Form fields dynamic -->
                        </form>
                    </div>
                    <div class="vdp-modal-footer">
                        <button class="vdp-btn vdp-btn-ghost vdp-modal-close">Cancel</button>
                        <button class="vdp-btn vdp-btn-primary" id="vdp-save-btn">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
        <?php
        return ob_get_clean();
    }

    public function ajax_get_data() {
        check_ajax_referer( 'vdp_nonce', 'nonce' );
        
        // Mock data for demo - in real plugin, pull from DB
        wp_send_json_success([
            'employees' => [
                [
                    'id' => '1',
                    'emp_id' => 'EMP001',
                    'first_name' => 'John',
                    'last_name' => 'Doe',
                    'start_date' => '2023-01-15',
                    'dob' => '1990-05-20',
                    'job_title' => 'Software Engineer',
                    'department' => 'Engineering',
                    'pay_rate' => 450.00,
                    'email' => 'john.doe@example.com',
                    'cell' => '0123456789',
                    'id_number' => '9005205000081',
                    'passport' => 'A1234567',
                    'bank_name' => 'Standard Bank',
                    'account_no' => '123456789',
                    'tax_number' => '9876543210',
                    'ismibco' => 'no',
                    'isunion' => 'no',
                    'address1' => '123 Main St',
                    'address2' => 'Suite 100',
                    'address3' => 'Sandton',
                    'address4' => 'Johannesburg',
                    'postal_code' => '2000',
                    'paye_credit' => 'None',
                    'annual_leave' => 15,
                    'sick_leave' => 10,
                    'family_leave' => 3,
                    'last_worked' => '2024-03-15'
                ],
                [
                    'id' => '2',
                    'emp_id' => 'EMP002',
                    'first_name' => 'Jane',
                    'last_name' => 'Smith',
                    'start_date' => '2023-03-10',
                    'dob' => '1992-11-12',
                    'job_title' => 'UI/UX Designer',
                    'department' => 'Design',
                    'pay_rate' => 300.00,
                    'email' => 'jane.smith@example.com',
                    'cell' => '0987654321',
                    'id_number' => '9211125000085',
                    'passport' => 'B7654321',
                    'bank_name' => 'FNB',
                    'account_no' => '987654321',
                    'tax_number' => '0123456789',
                    'ismibco' => 'no',
                    'isunion' => 'yes',
                    'address1' => '456 Oak Ave',
                    'address2' => 'Unit 4',
                    'address3' => 'Rosebank',
                    'address4' => 'Johannesburg',
                    'postal_code' => '2196',
                    'paye_credit' => 'None',
                    'annual_leave' => 15,
                    'sick_leave' => 10,
                    'family_leave' => 3,
                    'last_worked' => '2024-03-14'
                ]
            ]
        ]);
    }

    public function ajax_save_employee() {
        check_ajax_referer( 'vdp_nonce', 'nonce' );

        if ( ! current_user_can( 'manage_options' ) ) {
            wp_send_json_error( 'Unauthorized' );
        }

        $data = $_POST['employee_data'] ?? [];
        if ( empty( $data ) ) {
            wp_send_json_error( 'No data provided' );
        }

        // Validation Rules
        $errors = [];
        
        // Required Fields
        $required_fields = [
            'emp_id' => 'Employee ID',
            'first_name' => 'First Name',
            'last_name' => 'Last Name',
            'start_date' => 'Start Date',
            'dob' => 'Date of Birth',
            'job_title' => 'Job Title',
            'department' => 'Department',
            'pay_rate' => 'Pay Rate'
        ];

        foreach ( $required_fields as $field => $label ) {
            if ( empty( $data[$field] ) ) {
                $errors[] = "$label is required.";
            }
        }

        // Email validation
        if ( ! empty( $data['email'] ) && ! is_email( $data['email'] ) ) {
            $errors[] = "Invalid email format.";
        }

        // Numeric validation
        $numeric_fields = [
            'pay_rate' => 'Pay Rate',
            'annual_leave' => 'Annual Leave',
            'sick_leave' => 'Sick Leave',
            'family_leave' => 'Family Leave'
        ];

        foreach ( $numeric_fields as $field => $label ) {
            if ( ! empty( $data[$field] ) && ! is_numeric( $data[$field] ) ) {
                $errors[] = "$label must be a number.";
            }
        }

        // Date validation
        $date_fields = [
            'start_date' => 'Start Date',
            'dob' => 'Date of Birth',
            'last_worked' => 'Last Worked Date'
        ];

        foreach ( $date_fields as $field => $label ) {
            if ( ! empty( $data[$field] ) ) {
                $d = DateTime::createFromFormat('Y-m-d', $data[$field]);
                if ( ! $d || $d->format('Y-m-d') !== $data[$field] ) {
                    $errors[] = "Invalid date format for $label. Expected YYYY-MM-DD.";
                }
            }
        }

        if ( ! empty( $errors ) ) {
            wp_send_json_error( implode( ' ', $errors ) );
        }

        // In a real plugin, you would save to DB here
        // global $wpdb;
        // $table_name = $wpdb->prefix . 'vdp_employees';
        // ... save logic ...

        wp_send_json_success( 'Employee saved successfully' );
    }
}

new Veridian_Dashboard_Pro();
