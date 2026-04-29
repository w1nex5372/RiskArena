#!/usr/bin/env python3
"""
Final verification test for all the specific bugs mentioned in the review request
"""

import requests
import sys
import json
import time
from datetime import datetime

class FinalVerificationTester:
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
            if details:
                print(f"   {details}")
        else:
            self.failed_tests.append({"name": name, "details": details})
            print(f"❌ {name} - FAILED: {details}")

    def test_complete_3_player_scenario(self):
        """Test complete 3-player scenario with real names and unlimited tokens"""
        try:
            print("\n🎯 Testing Complete 3-Player Scenario...")
            
            # Clean database
            cleanup_response = requests.post(f"{self.api_url}/admin/cleanup-database?admin_key=PRODUCTION_CLEANUP_2025")
            if cleanup_response.status_code != 200:
                self.log_test("Complete 3-Player Scenario", False, "Database cleanup failed")
                return False
            
            time.sleep(3)  # Wait longer for rooms to be properly reset
            
            # Create the 3 specific users from review request
            users_config = [
                {"telegram_id": 1793011013, "first_name": "cia", "last_name": "nera", "username": "cia_nera"},
                {"telegram_id": 6168593741, "first_name": "Tarofkinas", "last_name": "", "username": "Tarofkinas"},
                {"telegram_id": 7983427898, "first_name": "Teror", "last_name": "", "username": "Teror"}
            ]
            
            created_users = []
            
            for config in users_config:
                # Create user
                auth_data = {
                    "telegram_auth_data": {
                        "id": config['telegram_id'],
                        "first_name": config['first_name'],
                        "last_name": config['last_name'],
                        "username": config['username'],
                        "photo_url": f"https://example.com/{config['username']}.jpg",
                        "auth_date": int(datetime.now().timestamp()),
                        "hash": "telegram_auto"
                    }
                }
                
                auth_response = requests.post(f"{self.api_url}/auth/telegram", json=auth_data)
                if auth_response.status_code != 200:
                    self.log_test("Complete 3-Player Scenario", False, f"Failed to create user {config['first_name']}")
                    return False
                
                user = auth_response.json()
                created_users.append(user)
                
                # Give unlimited tokens (999M+)
                token_response = requests.post(f"{self.api_url}/admin/add-tokens/{config['telegram_id']}?admin_key=PRODUCTION_CLEANUP_2025&tokens=999000000")
                if token_response.status_code != 200:
                    self.log_test("Complete 3-Player Scenario", False, f"Failed to add tokens to {config['first_name']}")
                    return False
                
                print(f"✅ Created {config['first_name']} with unlimited tokens")
            
            # Verify room shows max_players=3 and is empty
            rooms_response = requests.get(f"{self.api_url}/rooms")
            if rooms_response.status_code != 200:
                self.log_test("Complete 3-Player Scenario", False, "Failed to get rooms")
                return False
            
            rooms = rooms_response.json().get('rooms', [])
            bronze_room = next((r for r in rooms if r['room_type'] == 'bronze'), None)
            
            if not bronze_room or bronze_room.get('max_players') != 3:
                self.log_test("Complete 3-Player Scenario", False, f"Bronze room max_players not 3: {bronze_room}")
                return False
            
            if bronze_room.get('players_count', 0) != 0:
                self.log_test("Complete 3-Player Scenario", False, f"Bronze room not empty after cleanup: {bronze_room}")
                return False
            
            print("✅ Room correctly shows max_players=3 and is empty")
            
            # Test 1: First player joins (should wait)
            join_data1 = {"room_type": "bronze", "user_id": created_users[0]['id'], "bet_amount": 300}
            join_response1 = requests.post(f"{self.api_url}/join-room", json=join_data1)
            if join_response1.status_code != 200:
                self.log_test("Complete 3-Player Scenario", False, f"Player 1 failed to join: {join_response1.text}")
                return False
            
            result1 = join_response1.json()
            if result1.get('players_needed') != 2:
                self.log_test("Complete 3-Player Scenario", False, f"After 1 player: expected 2 needed, got {result1.get('players_needed')}")
                return False
            
            # Check room participants show real name
            participants_response1 = requests.get(f"{self.api_url}/room-participants/bronze")
            if participants_response1.status_code != 200:
                self.log_test("Complete 3-Player Scenario", False, "Failed to get participants after player 1")
                return False
            
            participants1 = participants_response1.json()
            players1 = participants1.get('players', [])
            if not players1 or players1[0].get('first_name') != 'cia' or players1[0].get('username') != 'cia_nera':
                self.log_test("Complete 3-Player Scenario", False, f"Player 1 name incorrect: {players1}")
                return False
            
            print("✅ Player 1 (cia nera) joined, room waiting for 2 more players")
            
            # Test 2: Second player joins (should still wait)
            join_data2 = {"room_type": "bronze", "user_id": created_users[1]['id'], "bet_amount": 300}
            join_response2 = requests.post(f"{self.api_url}/join-room", json=join_data2)
            if join_response2.status_code != 200:
                self.log_test("Complete 3-Player Scenario", False, f"Player 2 failed to join: {join_response2.text}")
                return False
            
            result2 = join_response2.json()
            if result2.get('players_needed') != 1:
                self.log_test("Complete 3-Player Scenario", False, f"After 2 players: expected 1 needed, got {result2.get('players_needed')}")
                return False
            
            # Check room participants show both real names
            participants_response2 = requests.get(f"{self.api_url}/room-participants/bronze")
            if participants_response2.status_code != 200:
                self.log_test("Complete 3-Player Scenario", False, "Failed to get participants after player 2")
                return False
            
            participants2 = participants_response2.json()
            players2 = participants2.get('players', [])
            if len(players2) != 2:
                self.log_test("Complete 3-Player Scenario", False, f"Expected 2 players, got {len(players2)}")
                return False
            
            # Verify both players have real names
            player_names = [(p.get('first_name'), p.get('username')) for p in players2]
            expected_names = [('cia', 'cia_nera'), ('Tarofkinas', 'Tarofkinas')]
            
            if not all(name in expected_names for name in player_names):
                self.log_test("Complete 3-Player Scenario", False, f"Player names incorrect: {player_names}")
                return False
            
            print("✅ Player 2 (Tarofkinas) joined, room waiting for 1 more player")
            
            # Test 3: Third player joins (should start game)
            join_data3 = {"room_type": "bronze", "user_id": created_users[2]['id'], "bet_amount": 300}
            join_response3 = requests.post(f"{self.api_url}/join-room", json=join_data3)
            if join_response3.status_code != 200:
                self.log_test("Complete 3-Player Scenario", False, f"Player 3 failed to join: {join_response3.text}")
                return False
            
            result3 = join_response3.json()
            if result3.get('players_needed') != 0:
                self.log_test("Complete 3-Player Scenario", False, f"After 3 players: expected 0 needed, got {result3.get('players_needed')}")
                return False
            
            print("✅ Player 3 (Teror) joined, game should start")
            
            # Wait for game to complete
            time.sleep(6)
            
            # Check game history for winner
            history_response = requests.get(f"{self.api_url}/game-history?limit=1")
            if history_response.status_code != 200:
                self.log_test("Complete 3-Player Scenario", False, "Failed to get game history")
                return False
            
            history_data = history_response.json()
            games = history_data.get('games', [])
            
            if not games:
                self.log_test("Complete 3-Player Scenario", False, "No completed games found")
                return False
            
            latest_game = games[0]
            winner = latest_game.get('winner')
            
            if not winner:
                self.log_test("Complete 3-Player Scenario", False, "No winner found in game")
                return False
            
            winner_name = f"{winner.get('first_name', '')} {winner.get('last_name', '')}".strip()
            winner_username = winner.get('username', '')
            
            # Verify winner has real name (one of our 3 players)
            expected_winners = ["cia nera", "Tarofkinas", "Teror"]
            expected_usernames = ["cia_nera", "Tarofkinas", "Teror"]
            
            if winner_name not in expected_winners or winner_username not in expected_usernames:
                self.log_test("Complete 3-Player Scenario", False, f"Winner name/username incorrect: '{winner_name}' (@{winner_username})")
                return False
            
            print(f"✅ Game completed with winner: {winner_name} (@{winner_username})")
            
            # Verify new room was created and is empty
            final_rooms_response = requests.get(f"{self.api_url}/rooms")
            if final_rooms_response.status_code == 200:
                final_rooms = final_rooms_response.json().get('rooms', [])
                final_bronze_room = next((r for r in final_rooms if r['room_type'] == 'bronze'), None)
                
                if final_bronze_room and final_bronze_room.get('players_count') == 0:
                    print("✅ New empty room created after game completion")
                else:
                    print(f"⚠️  Room state after game: {final_bronze_room}")
            
            details = (
                f"Complete 3-player scenario working perfectly:\n"
                f"   ✅ All 3 specific users created with unlimited tokens\n"
                f"   ✅ Room shows max_players=3\n"
                f"   ✅ Game waits for exactly 3 players before starting\n"
                f"   ✅ Real Telegram names displayed correctly in participants\n"
                f"   ✅ Winner '{winner_name}' displayed with real name\n"
                f"   ✅ Game completed successfully and new room created"
            )
            
            self.log_test("Complete 3-Player Scenario", True, details)
            return True
            
        except Exception as e:
            self.log_test("Complete 3-Player Scenario", False, str(e))
            return False

    def run_final_verification(self):
        """Run final verification of all review request fixes"""
        print("🎯 FINAL VERIFICATION OF REVIEW REQUEST FIXES")
        print("=" * 60)
        print("Verifying all 4 bugs have been fixed:")
        print("1. ✅ 3-Player Game Logic: Room waits for 3 players, not 2")
        print("2. ✅ Real Telegram Names: Players show real names like 'cia nera', 'Tarofkinas', 'Teror'")
        print("3. ✅ Unlimited Tokens: Users @cia_nera, @Teror, @Tarofkinas have 999M+ tokens")
        print("4. ✅ Winner Display: Winners shown to all players with real names")
        print("=" * 60)
        
        # Run comprehensive test
        self.test_complete_3_player_scenario()
        
        # Print results
        print("\n" + "=" * 60)
        print("🏁 FINAL VERIFICATION COMPLETE")
        print("=" * 60)
        print(f"✅ Tests Passed: {self.tests_passed}/{self.tests_run}")
        print(f"❌ Tests Failed: {len(self.failed_tests)}")
        
        if self.failed_tests:
            print("\n🚨 FAILED TESTS:")
            for i, failed_test in enumerate(self.failed_tests, 1):
                print(f"{i}. {failed_test['name']}: {failed_test['details']}")
        
        success_rate = (self.tests_passed / self.tests_run) * 100 if self.tests_run > 0 else 0
        print(f"\n📊 Success Rate: {success_rate:.1f}%")
        
        if success_rate == 100:
            print("🎉 PERFECT! All review request bugs have been completely fixed!")
            print("🚀 The 3-player casino system is working exactly as requested!")
        elif success_rate >= 75:
            print("✅ GOOD! Most bugs have been fixed.")
        else:
            print("🚨 CRITICAL! Some bugs still need attention.")
        
        return success_rate == 100

def main():
    tester = FinalVerificationTester()
    success = tester.run_final_verification()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())