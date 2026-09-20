plan "Cabin with Sleeping Loft" stack ground,loft

level ground "Ground Floor" ground
room main "Cabin Room" living rect 0,0 5x5

level loft "Sleeping Loft" h2
room loftroom "Loft" bedroom rect 0,0 5x2.5

stairs ladder "Ladder Stair" up:70
  at ground in:main rect 3.8,0.2 1x2
  at loft in:loftroom rect 3.8,0.2 1x2

door main.south w0.9
window main.north w1.5
