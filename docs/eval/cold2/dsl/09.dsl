plan "Courtyard House"

outdoor courtyard "Courtyard" rect 3,3 4x4

room north_room "North Room" living rect 3,0 4x3
room south_room "South Room" bedroom rect 3,7 4x3
room west_room "West Room" bedroom rect 0,3 3x4
room east_room "East Room" wc rect 7,3 3x4

door courtyard>north_room w0.9 hinge:start swing:north_room
door courtyard>south_room w0.9 hinge:start swing:south_room
door courtyard>west_room w0.8 hinge:start swing:west_room
door courtyard>east_room w0.8 hinge:start swing:east_room
