package cn.study.germanwords;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.net.Uri;
import java.io.*;

/** A deterministic SAF fixture for folder + individual-file imports, present only in test APK. */
public class FixtureDocumentsProvider extends ContentProvider {
    static final String AUTHORITY="cn.study.germanwords.test.documents";
    static final String[] COLUMNS={DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_FLAGS,DocumentsContract.Document.COLUMN_SIZE};
    @Override public boolean onCreate() { return true; }
    private void row(MatrixCursor cursor,String id) {
        boolean directory=id.equals("root") || id.equals("nested");
        String name=id.equals("root")?"Import test":id.equals("nested")?"einheit1":id.equals("book")?"SAF-Test.xlsx":id.equals("file")?"Individual-Test.xlsx":"lernen.mp3";
        MatrixCursor.RowBuilder row=cursor.newRow();
        for(String column:cursor.getColumnNames()) {
            switch(column) {
                case DocumentsContract.Document.COLUMN_DOCUMENT_ID:row.add(id);break;
                case DocumentsContract.Document.COLUMN_DISPLAY_NAME:row.add(name);break;
                case DocumentsContract.Document.COLUMN_MIME_TYPE:row.add(directory?DocumentsContract.Document.MIME_TYPE_DIR:id.equals("audio")?"audio/mpeg":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");break;
                case DocumentsContract.Document.COLUMN_FLAGS:row.add(0);break;
                case DocumentsContract.Document.COLUMN_SIZE:row.add(0);break;
                default:row.add(null);
            }
        }
    }
    public Cursor queryDocument(String id,String[] projection) { MatrixCursor cursor=new MatrixCursor(projection==null?COLUMNS:projection);row(cursor,id);return cursor; }
    public Cursor queryChildDocuments(String id,String[] projection,String sort) {
        MatrixCursor cursor=new MatrixCursor(projection==null?COLUMNS:projection);
        if(id.equals("root")){row(cursor,"book");row(cursor,"nested");}
        if(id.equals("nested"))row(cursor,"audio");
        return cursor;
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort) {
        String id=DocumentsContract.getDocumentId(uri);
        return uri.getLastPathSegment().equals("children")?queryChildDocuments(id,projection,sort):queryDocument(id,projection);
    }
    @Override public String getType(Uri uri){return "application/octet-stream";}
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode) throws FileNotFoundException {
        String id=DocumentsContract.getDocumentId(uri);
        try {
            android.content.Context target=getContext().createPackageContext("cn.study.germanwords",0);
            String asset=id.equals("audio")?"web/words/einheit1/lernen.mp3":"web/words/E1_单词汇总.xlsx";
            File cached=new File(getContext().getCacheDir(),id);
            try(InputStream in=target.getAssets().open(asset);OutputStream out=new FileOutputStream(cached)) {
                byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
            }
            return ParcelFileDescriptor.open(cached,ParcelFileDescriptor.MODE_READ_ONLY);
        } catch(Exception e){throw new FileNotFoundException(e.toString());}
    }
}
