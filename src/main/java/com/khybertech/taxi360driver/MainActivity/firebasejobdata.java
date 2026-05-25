package com.khybertech.taxi360driver.MainActivity;

import com.khybertech.taxi360driver.JobView.Fragments.appcontext;

/**
 * Created by Me on 1/25/2018.
 */


public class firebasejobdata {

    String TarrifId ="0";

    public String getTarrifId() {
        return TarrifId;
    }

    public void setTarrifId(String tarrifId) {
        TarrifId = tarrifId;
    }

    public firebasejobdata(String tarrifId, String metterstatus, String latlngpath, String time, String bookingid, String distance, String totalseconds, String waitingtime, String pickup, String dropoff) {
        TarrifId = tarrifId;
        this.metterstatus = metterstatus;
        this.latlngpath = latlngpath;
        this.time = time;
        this.bookingid = bookingid;
        this.distance = distance;
        this.totalseconds = totalseconds;
        this.waitingtime = waitingtime;
        this.pickup = pickup;
        this.dropoff = dropoff;
    }

    public firebasejobdata(String metterstatus, String latlngpath, String time, String bookingid, String distance, String totalseconds, String waitingtime, String pickup, String dropoff) {
        this.metterstatus = metterstatus;
        this.latlngpath = latlngpath;
        this.time = time;
        this.bookingid = bookingid;
        this.distance = distance;
        this.totalseconds = totalseconds;
        this.waitingtime = waitingtime;
        this.pickup = pickup;
        this.dropoff = dropoff;
    }

    public String getWaitingtime() {
        return waitingtime;
    }

    public void setWaitingtime(String waitingtime) {
        this.waitingtime = waitingtime;
    }

    public String getPickup() {
        return pickup;
    }

    public void setPickup(String pickup) {
        this.pickup = pickup;
    }

    public String getDropoff() {
        return dropoff;
    }

    public void setDropoff(String dropoff) {
        this.dropoff = dropoff;
    }

    String metterstatus,latlngpath,time,bookingid, distance, totalseconds,waitingtime,pickup,dropoff;


    public firebasejobdata() {
    }

    public String getDistance() {
        return distance;
    }

    public void setDistance(String distance) {
        this.distance = distance;
    }

    public String getTotalseconds() {
        return totalseconds;
    }

    public void setTotalseconds(String totalseconds) {
        this.totalseconds = totalseconds;
    }

    public firebasejobdata(String metterstatus, String latlngpath, String time, String bookingid, String distance, String totalseconds) {
        this.metterstatus = metterstatus;
        this.latlngpath = latlngpath;
        this.time = time;
        this.bookingid = bookingid;
        this.distance = distance;
        this.totalseconds = totalseconds;
    }

    public String getMetterstatus() {
        return metterstatus;
    }

    public void setMetterstatus(String metterstatus) {
        this.metterstatus = metterstatus;
    }

    public String getLatlngpath() {
        return latlngpath;
    }

    public void setLatlngpath(String latlngpath) {
        this.latlngpath = latlngpath;
    }

    public String getTime() {
        return time;
    }

    public void setTime(String time) {
        this.time = time;
    }

    public String getBookingid() {
        return bookingid;
    }

    public void setBookingid(String bookingid) {
        this.bookingid = bookingid;
    }
}
