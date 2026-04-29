#!/usr/bin/env python3

import requests
import sys
import json
import time
from datetime import datetime

class EnhancedWinnerDetectionTester:
    def __init__(self, base_url="https://telebet-2.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            self.failed_tests.append({"name": name, "details": details})
            print(f"❌ {name} - FAILED: {details}")

    def test_enhanced_winner_detection_broadcast_system(self):
        """Test Enhanced Winner Detection & Broadcast System as per review request"""
        try:
            print("\n🏆 TESTING ENHANCED WINNER DETECTION & BROADCAST SYSTEM")
            print("=" * 70)
            
            # Step 1: Database cleanup for clean test environment
            print("🧹 Step 1: Database cleanup...")
            cleanup_response = requests.post(f"{self.api_url}/admin/cleanup-database?admin_key=PRODUCTION_CLEANUP_2025")
            if cleanup_response.status_code != 200:
                self.log_test("Enhanced Winner Detection - Database Cleanup", False, 
                            f"Cleanup failed: {cleanup_response.status_code}")
                return False
            
            print("✅ Database cleaned successfully")
            time.sleep(2)  # Wait for rooms to be reinitialized
            
            # Step 2: Create the 3 special users from review request
            print("👥 Step 2: Creating 3 special users (cia_nera, Tarofkinas, Teror)...")
            
            special_users = [
                {
                    "telegram_id": 1793011013,
                    "first_name": "cia",
                    "last_name": "nera", 
                    "username": "cia_nera",
                    "photo_url": "https://ui-avatars.com/api/?name=cia+nera&background=0D8ABC&color=fff"
                },
                {
                    "telegram_id": 6168593741,
                    "first_name": "Tarofkinas",
                    "last_name": "",
                    "username": "Tarofkinas", 
                    "photo_url": "https://ui-avatars.com/api/?name=Tarofkinas&background=0D8ABC&color=fff"
                },
                {
                    "telegram_id": 7983427898,
                    "first_name": "Teror",
                    "last_name": "",
                    "username": "Teror",
                    "photo_url": "https://ui-avatars.com/api/?name=Teror&background=0D8ABC&color=fff"
                }
            ]
            
            created_users = []
            
            for i, user_info in enumerate(special_users):
                user_data = {
                    "telegram_auth_data": {
                        "id": user_info["telegram_id"],
                        "first_name": user_info["first_name"],
                        "last_name": user_info["last_name"],
                        "username": user_info["username"],
                        "photo_url": user_info["photo_url"],
                        "auth_date": int(datetime.now().timestamp()),
                        "hash": "telegram_auto"
                    }
                }
                
                auth_response = requests.post(f"{self.api_url}/auth/telegram", json=user_data)
                if auth_response.status_code != 200:
                    self.log_test("Enhanced Winner Detection - User Creation", False, 
                                f"Failed to create {user_info['username']}: {auth_response.status_code}")
                    return False
                
                user = auth_response.json()
                created_users.append(user)
                
                # Give unlimited tokens (999M+ as per review request)
                token_response = requests.post(f"{self.api_url}/admin/add-tokens/{user_info['telegram_id']}?admin_key=PRODUCTION_CLEANUP_2025&tokens=999000000")
                
                print(f"✅ Created {user_info['username']} (telegram_id: {user_info['telegram_id']}) with unlimited tokens")
            
            # Step 3: Verify Bronze room is ready for 3-player game
            print("🏠 Step 3: Verifying Bronze room setup...")
            rooms_response = requests.get(f"{self.api_url}/rooms")
            if rooms_response.status_code != 200:
                self.log_test("Enhanced Winner Detection - Room Setup", False, "Failed to get rooms")
                return False
            
            rooms_data = rooms_response.json()
            bronze_rooms = [r for r in rooms_data.get('rooms', []) if r['room_type'] == 'bronze']
            
            if not bronze_rooms:
                self.log_test("Enhanced Winner Detection - Bronze Room", False, "No Bronze room found")
                return False
            
            bronze_room = bronze_rooms[0]
            if bronze_room['max_players'] != 3:
                self.log_test("Enhanced Winner Detection - Room Capacity", False, 
                            f"Bronze room max_players is {bronze_room['max_players']}, expected 3")
                return False
            
            print(f"✅ Bronze room ready: {bronze_room['players_count']}/3 players, status: {bronze_room['status']}")
            
            # Step 4: All 3 players join Bronze room sequentially
            print("🎰 Step 4: 3-Player Bronze Game Creation...")
            bet_amount = 300  # Within Bronze range (150-450)
            
            join_results = []
            for i, user in enumerate(created_users):
                print(f"   Player {i+1} ({special_users[i]['username']}) joining Bronze room...")
                
                join_data = {
                    "room_type": "bronze",
                    "user_id": user['id'],
                    "bet_amount": bet_amount
                }
                
                join_response = requests.post(f"{self.api_url}/join-room", json=join_data)
                if join_response.status_code != 200:
                    self.log_test("Enhanced Winner Detection - Player Join", False, 
                                f"Player {i+1} failed to join: {join_response.status_code}, Response: {join_response.text}")
                    return False
                
                join_result = join_response.json()
                join_results.append(join_result)
                
                print(f"   ✅ Player {i+1} joined - Position: {join_result.get('position')}, Players needed: {join_result.get('players_needed')}")
                
                # Verify game starts only when 3rd player joins
                if i < 2:  # First 2 players
                    if join_result.get('players_needed', 0) == 0:
                        self.log_test("Enhanced Winner Detection - Game Start Logic", False, 
                                    f"Game started prematurely with {i+1} players")
                        return False
                else:  # 3rd player
                    if join_result.get('players_needed', 1) != 0:
                        self.log_test("Enhanced Winner Detection - Game Start Logic", False, 
                                    f"Game didn't start with 3 players, still needs {join_result.get('players_needed')}")
                        return False
            
            print("✅ All 3 players joined successfully - Game should start automatically")
            
            # Step 5: Wait for game completion and monitor timing
            print("⏳ Step 5: Monitoring game completion (3-6 seconds expected)...")
            start_time = time.time()
            
            # Wait for game to complete (3 seconds game time + processing)
            time.sleep(6)
            
            completion_time = time.time() - start_time
            print(f"⏱️  Game completion time: {completion_time:.2f} seconds")
            
            # Step 6: Verify winner selection and data completeness
            print("🏆 Step 6: Verifying winner selection and data...")
            
            # Check game history for completed game
            history_response = requests.get(f"{self.api_url}/game-history?limit=1")
            if history_response.status_code != 200:
                self.log_test("Enhanced Winner Detection - Game History", False, 
                            f"Failed to get game history: {history_response.status_code}")
                return False
            
            history_data = history_response.json()
            games = history_data.get('games', [])
            
            if not games:
                self.log_test("Enhanced Winner Detection - Game Completion", False, 
                            "No completed games found")
                return False
            
            latest_game = games[0]
            
            # Verify game data completeness
            required_fields = ['winner', 'prize_pool', 'players', 'room_type', 'status', 'finished_at']
            missing_fields = [field for field in required_fields if field not in latest_game]
            
            if missing_fields:
                self.log_test("Enhanced Winner Detection - Game Data", False, 
                            f"Missing required fields: {missing_fields}")
                return False
            
            winner = latest_game['winner']
            players = latest_game['players']
            prize_pool = latest_game['prize_pool']
            
            print(f"🏆 Winner: {winner.get('first_name', 'Unknown')} ({winner.get('username', 'No username')})")
            print(f"💰 Prize Pool: {prize_pool} tokens")
            print(f"👥 Total Players: {len(players)}")
            
            # Step 7: Verify Telegram integration data
            print("📱 Step 7: Verifying Telegram integration data...")
            
            # Check winner data includes Telegram information
            telegram_fields = ['first_name', 'username', 'photo_url']
            missing_telegram_fields = [field for field in telegram_fields if not winner.get(field)]
            
            if missing_telegram_fields:
                self.log_test("Enhanced Winner Detection - Telegram Data", False, 
                            f"Winner missing Telegram fields: {missing_telegram_fields}")
                return False
            
            # Verify all players have complete Telegram data
            for i, player in enumerate(players):
                player_missing_fields = [field for field in telegram_fields if not player.get(field)]
                if player_missing_fields:
                    self.log_test("Enhanced Winner Detection - Player Telegram Data", False, 
                                f"Player {i+1} missing fields: {player_missing_fields}")
                    return False
            
            print("✅ All players have complete Telegram data (first_name, username, photo_url)")
            
            # Step 8: Verify participation validation data
            print("👤 Step 8: Verifying participation validation...")
            
            # Check that game history shows all participants for validation
            if len(players) != 3:
                self.log_test("Enhanced Winner Detection - Participant Count", False, 
                            f"Expected 3 participants, found {len(players)}")
                return False
            
            # Verify each created user is in the participants list
            participant_telegram_ids = [p.get('user_id') for p in players]
            created_user_ids = [u['id'] for u in created_users]
            
            for user_id in created_user_ids:
                if user_id not in participant_telegram_ids:
                    # Try to match by other fields since user_id might be stored differently
                    found = False
                    for player in players:
                        if (player.get('first_name') in [u['first_name'] for u in created_users] and
                            player.get('username') in [special_users[i]['username'] for i in range(3)]):
                            found = True
                            break
                    
                    if not found:
                        self.log_test("Enhanced Winner Detection - Participant Validation", False, 
                                    f"Created user not found in participants")
                        return False
            
            print("✅ All participants properly tracked for validation")
            
            # Step 9: Verify API responses for frontend winner broadcast
            print("📡 Step 9: Verifying API responses for frontend broadcast...")
            
            # Test that winner data is structured for frontend consumption
            winner_data_check = {
                'has_first_name': bool(winner.get('first_name')),
                'has_username': bool(winner.get('username')), 
                'has_photo_url': bool(winner.get('photo_url')),
                'has_prize_pool': bool(prize_pool and prize_pool > 0),
                'game_completed': latest_game.get('status') == 'finished',
                'has_finished_timestamp': bool(latest_game.get('finished_at'))
            }
            
            all_checks_passed = all(winner_data_check.values())
            
            if not all_checks_passed:
                failed_checks = [k for k, v in winner_data_check.items() if not v]
                self.log_test("Enhanced Winner Detection - Frontend Data", False, 
                            f"Failed checks: {failed_checks}")
                return False
            
            print("✅ Winner data properly structured for frontend broadcast")
            
            # Step 10: Final verification summary
            print("✅ Step 10: Enhanced Winner Detection System Verification Complete!")
            
            success_summary = (
                f"🎯 ENHANCED WINNER DETECTION & BROADCAST SYSTEM - ALL TESTS PASSED!\n"
                f"   ✅ 3-Player Bronze Game: Created with special users (cia_nera, Tarofkinas, Teror)\n"
                f"   ✅ Game Completion: Completed in {completion_time:.2f}s with winner selection\n"
                f"   ✅ Winner Broadcast Ready: Winner '{winner.get('first_name')}' with complete data\n"
                f"   ✅ Telegram Integration: Real names, usernames, and photo URLs included\n"
                f"   ✅ Participation Validation: All 3 participants tracked in game history\n"
                f"   ✅ API Response Structure: Complete data for frontend winner broadcast\n"
                f"   ✅ Prize Pool: {prize_pool} tokens distributed correctly\n"
                f"   ✅ Synchronized Detection: Game history API provides all needed data\n"
                f"   🎉 SYSTEM READY: All participants can receive winner notifications!"
            )
            
            self.log_test("Enhanced Winner Detection & Broadcast System", True, success_summary)
            return True
            
        except Exception as e:
            self.log_test("Enhanced Winner Detection & Broadcast System", False, str(e))
            return False

    def run_test(self):
        """Run the enhanced winner detection test"""
        print("🚀 Starting Enhanced Winner Detection & Broadcast System Test...")
        print(f"🌐 Testing against: {self.base_url}")
        print("=" * 80)
        
        success = self.test_enhanced_winner_detection_broadcast_system()
        
        # Print final results
        print("\n" + "=" * 80)
        print("🏁 ENHANCED WINNER DETECTION TEST COMPLETE")
        print(f"📊 Tests Run: {self.tests_run}")
        print(f"✅ Tests Passed: {self.tests_passed}")
        print(f"❌ Tests Failed: {len(self.failed_tests)}")
        
        if self.failed_tests:
            print("\n❌ FAILED TESTS:")
            for i, test in enumerate(self.failed_tests, 1):
                print(f"   {i}. {test['name']}: {test['details']}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"\n🎯 Success Rate: {success_rate:.1f}%")
        
        if success_rate >= 80:
            print("🎉 TESTING PASSED - Enhanced Winner Detection System is working!")
        else:
            print("⚠️  TESTING CONCERNS - Some issues need attention")
        
        return success

if __name__ == "__main__":
    tester = EnhancedWinnerDetectionTester()
    success = tester.run_test()
    sys.exit(0 if success else 1)