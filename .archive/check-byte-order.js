/**
 * Check byte ordering issue
 */

const our = '333d15951a04cc86abded8d6ddb4637572e92a5f80af1ddcc7e643e2d0c03dda';
const ref = 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';

console.log('Our result:', our);
console.log('Ref result:', ref);

// Try different byte reversals
console.log('\n=== Trying different transformations ===');

// Reverse entire string
const reversed = our.split('').reverse().join('');
console.log('Fully reversed:', reversed);
console.log('Matches ref? ', reversed === ref);

// Reverse by 2-char pairs (byte reversal)
const byteReversed = our.match(/.{1,2}/g).reverse().join('');
console.log('Byte-reversed:', byteReversed);
console.log('Matches ref? ', byteReversed === ref);

// Reverse by 16-char chunks (lane reversal)
const laneReversed = our.match(/.{1,16}/g).reverse().join('');
console.log('Lane-reversed:', laneReversed);
console.log('Matches ref? ', laneReversed === ref);

// Reverse each 16-char chunk
const chunksReversed = our.match(/.{1,16}/g).map(chunk => chunk.split('').reverse().join('')).join('');
console.log('Chunks reversed:', chunksReversed);
console.log('Matches ref? ', chunksReversed === ref);

// Reverse both: chunks and within chunks
const bothReversed = our.match(/.{1,16}/g).reverse().map(chunk => chunk.split('').reverse().join('')).join('');
console.log('Both reversed:', bothReversed);
console.log('Matches ref? ', bothReversed === ref);

// Reverse lane endianness
const lanes = [];
for (let i = 0; i < our.length; i += 16) {
  lanes.push(our.slice(i, i + 16));
}
console.log('\nLane breakdown (ours):');
lanes.forEach((lane, i) => console.log(`  Lane ${i}: ${lane}`));

const refLanes = [];
for (let i = 0; i < ref.length; i += 16) {
  refLanes.push(ref.slice(i, i + 16));
}
console.log('\nLane breakdown (ref):');
refLanes.forEach((lane, i) => console.log(`  Lane ${i}: ${lane}`));

// Try reversing each lane's bytes
const laneByteReversed = lanes.map(lane => lane.match(/.{1,2}/g).reverse().join('')).join('');
console.log('\nLane byte-reversed:', laneByteReversed);
console.log('Matches ref? ', laneByteReversed === ref);
